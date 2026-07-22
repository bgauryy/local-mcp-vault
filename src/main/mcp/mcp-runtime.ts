import type { McpConfigService } from '../vault/env-service.js';
import { StdioMcpClient } from './stdio-client.js';
import type { ServerHealth } from '../../shared/types.js';

export class McpRuntime {
  private readonly stdioClients = new Map<string, StdioMcpClient>();

  constructor(private readonly configService: McpConfigService) {}

  async handle(serverId: string, message: unknown): Promise<unknown> {
    const server = this.configService.getServer(serverId);
    if (!server) return jsonRpcError(message, -32004, `MCP server not found: ${serverId}`);
    if (!server.enabled) return jsonRpcError(message, -32003, `MCP server disabled: ${serverId}`);
    const method = readJsonRpcMethod(message);
    const estimatedTokens = estimateTokens(message);
    try {
      const result = server.transport === 'http' ? await this.forwardHttp(server.url!, message) : await this.handleStdio(serverId, message);
      this.configService.recordUsage(serverId, method, estimatedTokens + estimateTokens(result), true);
      return result;
    } catch (error) {
      this.configService.recordUsage(serverId, method, estimatedTokens, false);
      throw error;
    }
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
      return;
    }
    for (const client of this.stdioClients.values()) client.stop();
    this.stdioClients.clear();
  }

  private async handleStdio(serverId: string, message: unknown): Promise<unknown> {
    const client = await this.getStdioClient(serverId);
    const hasId = message && typeof message === 'object' && 'id' in message;
    if (hasId) return client.request(message);
    await client.notify(message);
    return { accepted: true };
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

  private async forwardHttp(url: string, message: unknown): Promise<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(message)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Upstream MCP HTTP ${response.status}: ${text.slice(0, 200)}`);
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
      return dataLine ? JSON.parse(dataLine.slice(5).trim()) : { accepted: true };
    }
    return text ? JSON.parse(text) : { accepted: true };
  }
}

function jsonRpcError(message: unknown, code: number, text: string) {
  const id = message && typeof message === 'object' && 'id' in message ? (message as { id?: unknown }).id ?? null : null;
  return { jsonrpc: '2.0', id, error: { code, message: text } };
}

function readJsonRpcMethod(message: unknown): string | undefined {
  return message && typeof message === 'object' && 'method' in message && typeof (message as { method?: unknown }).method === 'string' ? (message as { method: string }).method : undefined;
}

function estimateTokens(value: unknown): number {
  const text = JSON.stringify(value) ?? '';
  return Math.max(1, Math.ceil(text.length / 4));
}
