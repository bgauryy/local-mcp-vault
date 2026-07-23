import { randomUUID } from 'node:crypto';
import type { McpConfigService } from '../vault/env-service.js';
import { StdioMcpClient, type ServerMessageListener } from './stdio-client.js';
import type { McpServerWithEnv, ServerHealth } from '../../shared/types.js';

/** Result of handling a POST: either a 202 (no body) or a JSON-RPC response body. */
export interface HandleResult {
  accepted?: boolean;
  body?: unknown;
  /** Session id to echo back to the client via the Mcp-Session-Id header. */
  sessionId?: string;
}

export interface HandleContext {
  /** Session id supplied by the client (Mcp-Session-Id request header). */
  sessionId?: string;
}

export class McpRuntime {
  private readonly stdioClients = new Map<string, StdioMcpClient>();
  private readonly sessions = new Map<string, string>();

  constructor(private readonly configService: McpConfigService) {}

  async handle(serverId: string, message: unknown, ctx: HandleContext = {}): Promise<HandleResult> {
    const server = this.configService.getServer(serverId);
    if (!server) return { body: jsonRpcError(message, -32004, `MCP server not found: ${serverId}`) };
    if (!server.enabled) return { body: jsonRpcError(message, -32003, `MCP server disabled: ${serverId}`) };

    const estimatedTokens = estimateTokens(message);
    try {
      const result = Array.isArray(message)
        ? await this.handleBatch(server, message, ctx)
        : await this.handleSingle(server, message, ctx);
      this.configService.recordUsage(serverId, firstMethod(message), estimatedTokens + estimateTokens(result.body), true);
      return result;
    } catch (error) {
      this.configService.recordUsage(serverId, firstMethod(message), estimatedTokens, false);
      throw error;
    }
  }

  private async handleSingle(server: McpServerWithEnv, message: unknown, ctx: HandleContext): Promise<HandleResult> {
    const isRequest = hasId(message) && hasMethod(message);
    if (server.transport === 'http') {
      const forwarded = await this.forwardHttp(server, message, ctx.sessionId);
      return isRequest ? forwarded : { accepted: true, ...(forwarded.sessionId ? { sessionId: forwarded.sessionId } : {}) };
    }
    // stdio
    if (!isRequest) {
      await (await this.getStdioClient(server.id)).notify(message);
      return { accepted: true };
    }
    const body = await (await this.getStdioClient(server.id)).request(message);
    return this.withStdioSession(server.id, message, { body });
  }

  private async handleBatch(server: McpServerWithEnv, batch: unknown[], ctx: HandleContext): Promise<HandleResult> {
    const hasRequest = batch.some((entry) => hasId(entry) && hasMethod(entry));
    if (server.transport === 'http') {
      const forwarded = await this.forwardHttp(server, batch, ctx.sessionId);
      return hasRequest ? forwarded : { accepted: true, ...(forwarded.sessionId ? { sessionId: forwarded.sessionId } : {}) };
    }
    // stdio: send each entry; collect responses for the request entries only.
    const client = await this.getStdioClient(server.id);
    const responses: unknown[] = [];
    for (const entry of batch) {
      if (hasId(entry) && hasMethod(entry)) responses.push(await client.request(entry));
      else await client.notify(entry);
    }
    if (!hasRequest) return { accepted: true };
    return this.withStdioSession(server.id, batch, { body: responses });
  }

  /** Subscribe to server→client messages for the GET SSE stream (stdio only). */
  async subscribe(serverId: string, listener: ServerMessageListener): Promise<() => void> {
    const server = this.configService.getServer(serverId);
    if (!server) throw new Error(`MCP server not found: ${serverId}`);
    if (!server.enabled) throw new Error(`MCP server disabled: ${serverId}`);
    if (server.transport !== 'stdio') throw new Error('SSE subscription is only supported for stdio servers');
    const client = await this.getStdioClient(serverId);
    return client.onMessage(listener);
  }

  /** Open the upstream GET event stream for an HTTP server, to be piped to the client. */
  async openHttpEventStream(serverId: string, sessionId: string | undefined): Promise<ReadableStream<Uint8Array>> {
    const server = this.configService.getServer(serverId);
    if (!server || server.transport !== 'http' || !server.url) throw new Error('No HTTP MCP endpoint for event stream');
    const response = await fetch(server.url, {
      method: 'GET',
      headers: { accept: 'text/event-stream', ...(sessionId ? { 'mcp-session-id': sessionId } : {}) }
    });
    if (!response.ok || !response.body) throw new Error(`Upstream GET stream failed: HTTP ${response.status}`);
    return response.body;
  }

  /** Terminate a session (DELETE): stop the stdio process or forward to the HTTP upstream. */
  async terminate(serverId: string, sessionId: string | undefined): Promise<void> {
    const server = this.configService.getServer(serverId);
    this.sessions.delete(serverId);
    if (server?.transport === 'http' && server.url) {
      await fetch(server.url, { method: 'DELETE', headers: { ...(sessionId ? { 'mcp-session-id': sessionId } : {}) } }).catch(() => undefined);
      return;
    }
    this.stop(serverId);
  }

  health(serverId: string): ServerHealth {
    const server = this.configService.getServer(serverId);
    if (!server) return { serverId, ok: false, status: 'error', message: 'Server not found' };
    if (!server.enabled) return { serverId, ok: false, status: 'disabled', message: 'Server disabled' };
    const client = this.stdioClients.get(serverId);
    if (!client) return { serverId, ok: true, status: 'ready', message: 'Configured' };
    const health = client.health();
    return { serverId, ok: health.ok, status: health.ok ? 'ready' : 'error', message: health.message };
  }

  stop(serverId?: string): void {
    if (serverId) {
      this.stdioClients.get(serverId)?.stop();
      this.stdioClients.delete(serverId);
      this.sessions.delete(serverId);
      return;
    }
    for (const client of this.stdioClients.values()) client.stop();
    this.stdioClients.clear();
    this.sessions.clear();
  }

  /** Attach a session id (established at initialize) so the gateway can echo the header. */
  private withStdioSession(serverId: string, message: unknown, result: HandleResult): HandleResult {
    if (!includesMethod(message, 'initialize')) return result;
    let sessionId = this.sessions.get(serverId);
    if (!sessionId) {
      sessionId = randomUUID();
      this.sessions.set(serverId, sessionId);
    }
    return { ...result, sessionId };
  }

  private async getStdioClient(serverId: string): Promise<StdioMcpClient> {
    const existing = this.stdioClients.get(serverId);
    if (existing) return existing;
    const server = this.configService.getServer(serverId);
    if (!server) throw new Error(`MCP server not found: ${serverId}`);
    const env = await this.configService.resolveEnv(server);
    const client = new StdioMcpClient(server, env);
    this.stdioClients.set(serverId, client);
    return client;
  }

  private async forwardHttp(server: McpServerWithEnv, message: unknown, sessionId: string | undefined): Promise<HandleResult> {
    const response = await fetch(server.url!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {})
      },
      body: JSON.stringify(message)
    });
    const upstreamSession = response.headers.get('mcp-session-id') ?? undefined;
    const sessionPatch = upstreamSession ? { sessionId: upstreamSession } : {};
    if (response.status === 202) return { accepted: true, ...sessionPatch };
    const text = await response.text();
    if (!response.ok) throw new Error(`Upstream MCP HTTP ${response.status}: ${text.slice(0, 200)}`);
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const body = parseEventStream(text);
      return { body, ...sessionPatch };
    }
    return { body: text ? JSON.parse(text) : { accepted: true }, ...sessionPatch };
  }
}

function jsonRpcError(message: unknown, code: number, text: string) {
  const id = message && typeof message === 'object' && 'id' in message ? (message as { id?: unknown }).id ?? null : null;
  return { jsonrpc: '2.0', id, error: { code, message: text } };
}

function hasId(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'id' in value && (value as { id?: unknown }).id !== undefined;
}

function hasMethod(value: unknown): boolean {
  return !!value && typeof value === 'object' && typeof (value as { method?: unknown }).method === 'string';
}

function firstMethod(message: unknown): string | undefined {
  const target = Array.isArray(message) ? message.find((entry) => hasMethod(entry)) : message;
  return hasMethod(target) ? (target as { method: string }).method : undefined;
}

function includesMethod(message: unknown, method: string): boolean {
  const entries = Array.isArray(message) ? message : [message];
  return entries.some((entry) => hasMethod(entry) && (entry as { method: string }).method === method);
}

/** Concatenate the JSON payloads from SSE `data:` lines into the last complete message. */
function parseEventStream(text: string): unknown {
  const dataLines = text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
  const payload = dataLines.join('');
  return payload ? JSON.parse(payload) : { accepted: true };
}

function estimateTokens(value: unknown): number {
  const text = JSON.stringify(value) ?? '';
  return Math.max(1, Math.ceil(text.length / 4));
}
