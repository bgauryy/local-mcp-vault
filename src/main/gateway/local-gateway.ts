import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ACCESS_KEY_HEADER, type McpConfigService } from '../vault/env-service.js';
import type { McpRuntime } from '../mcp/mcp-runtime.js';
import type { GatewayConfig } from '../../shared/types.js';

export interface LocalGatewayOptions {
  port?: number;
  accessKey?: string;
}

const SSE_KEEPALIVE_MS = 15_000;

export class LocalGateway {
  private server: Server | null = null;
  private readonly host: '127.0.0.1' = '127.0.0.1';
  private readonly port: number;
  private accessKey: string;

  constructor(private readonly configService: McpConfigService, private readonly runtime: McpRuntime, options: LocalGatewayOptions = {}) {
    this.port = options.port ?? Number(process.env.OCTOVAULT_PORT ?? 1987);
    this.accessKey = options.accessKey ?? randomBytes(24).toString('base64url');
  }

  get config(): GatewayConfig {
    return { host: this.host, port: this.port, accessKey: this.accessKey };
  }

  /** Seed the master key once it's been resolved from the KeyStore. */
  setAccessKey(key: string): void {
    this.accessKey = key;
  }

  app() {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '2mb' }));
    app.use(this.hostOriginGuard.bind(this));

    app.get('/status', (_req, res) => {
      res.json({ ok: true });
    });

    app.get('/servers', this.masterKeyGuard.bind(this), (_req, res) => {
      res.json(this.publicServers());
    });

    app.get('/health/:serverId', this.masterKeyGuard.bind(this), (req, res) => {
      res.json(this.runtime.health(readServerId(req)));
    });

    app.get('/config/:serverId', this.masterKeyGuard.bind(this), async (req, res, next) => {
      try {
        const serverId = readServerId(req);
        if (!this.configService.getServer(serverId)) return res.status(404).json({ error: 'Server not found' });
        return res.json(await this.configService.buildClientConfig(serverId));
      } catch (error) {
        return next(error);
      }
    });

    // ── MCP Streamable HTTP endpoint ──────────────────────────────────────────
    app.post('/mcp/:serverId', this.mcpAccessGuard.bind(this), async (req, res, next) => {
      try {
        const result = await this.runtime.handle(readServerId(req), req.body, { sessionId: sessionHeader(req) });
        if (result.sessionId) res.setHeader('Mcp-Session-Id', result.sessionId);
        if (result.accepted) return res.status(202).end();
        return res.json(result.body);
      } catch (error) {
        return next(error);
      }
    });

    app.get('/mcp/:serverId', this.mcpAccessGuard.bind(this), (req, res) => {
      void this.openEventStream(req, res);
    });

    app.delete('/mcp/:serverId', this.mcpAccessGuard.bind(this), async (req, res, next) => {
      try {
        await this.runtime.terminate(readServerId(req), sessionHeader(req));
        return res.status(204).end();
      } catch (error) {
        return next(error);
      }
    });

    app.all('/mcp/:serverId', this.mcpAccessGuard.bind(this), (_req, res) => {
      res.status(405).json({ error: 'Method not allowed on the MCP endpoint' });
    });

    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      // Log details locally; return a generic message so upstream/error text
      // (which may echo secret material) never reaches the client.
      console.error('[octovault:gateway]', error instanceof Error ? error.stack ?? error.message : error);
      if (!res.headersSent) res.status(500).json({ error: 'Gateway request failed' });
    });
    return app;
  }

  async start(): Promise<GatewayConfig> {
    if (this.server) return this.config;
    const app = this.app();
    await new Promise<void>((resolve, reject) => {
      const server = app.listen(this.port, this.host);
      server.once('listening', () => {
        this.server = server;
        resolve();
      });
      server.once('error', (error) => {
        server.close();
        reject(error);
      });
    });
    return this.config;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => error ? reject(error) : resolve());
    });
    this.server = null;
  }

  localMcpUrl(serverId: string): string {
    return `http://${this.host}:${this.port}/mcp/${encodeURIComponent(serverId)}`;
  }

  // ── Server→client SSE stream ────────────────────────────────────────────────
  private async openEventStream(req: Request, res: Response): Promise<void> {
    const serverId = readServerId(req);
    if (!req.accepts('text/event-stream')) {
      res.status(405).json({ error: 'GET on the MCP endpoint requires Accept: text/event-stream' });
      return;
    }
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders?.();

    const cleanups: Array<() => void> = [];
    const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, SSE_KEEPALIVE_MS);
    cleanups.push(() => clearInterval(keepAlive));
    req.on('close', () => { for (const fn of cleanups) fn(); });

    const server = this.configService.getServer(serverId);
    try {
      if (server?.transport === 'http') {
        await this.pipeUpstreamStream(serverId, sessionHeader(req), res, cleanups);
      } else {
        const unsubscribe = await this.runtime.subscribe(serverId, (message) => {
          if (!res.writableEnded) res.write(`data: ${JSON.stringify(message)}\n\n`);
        });
        cleanups.push(unsubscribe);
      }
    } catch (error) {
      console.error('[octovault:gateway] SSE stream error', error);
      if (!res.writableEnded) res.end();
    }
  }

  private async pipeUpstreamStream(serverId: string, sessionId: string | undefined, res: Response, cleanups: Array<() => void>): Promise<void> {
    const stream = await this.runtime.openHttpEventStream(serverId, sessionId);
    const reader = stream.getReader();
    cleanups.push(() => void reader.cancel().catch(() => undefined));
    for (;;) {
      const { done, value } = await reader.read();
      if (done || res.writableEnded) break;
      if (value) res.write(Buffer.from(value));
    }
    if (!res.writableEnded) res.end();
  }

  private publicServers() {
    // Env values are sealed and write-only; never expose any value over HTTP.
    return this.configService.listServers().map((server) => ({
      ...server,
      env: server.env.map((env) => ({ ...env, value: null }))
    }));
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  private masterKeyGuard(req: Request, res: Response, next: NextFunction): void {
    if (keyMatches(req.header(ACCESS_KEY_HEADER), this.accessKey)) return next();
    res.status(401).json({ error: 'Missing or invalid OctoVault access key' });
  }

  /** /mcp routes accept the master key OR the per-server key. */
  private mcpAccessGuard(req: Request, res: Response, next: NextFunction): void {
    const provided = req.header(ACCESS_KEY_HEADER);
    if (keyMatches(provided, this.accessKey)) return next();
    const serverId = req.params.serverId;
    const serverKey = serverId ? this.configService.getServerAccessKey(serverId) : '';
    if (serverKey && keyMatches(provided, serverKey)) return next();
    res.status(401).json({ error: 'Missing or invalid OctoVault access key' });
  }

  private hostOriginGuard(req: Request, res: Response, next: NextFunction): void {
    const host = req.headers.host?.split(':')[0]?.toLowerCase();
    const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
    if (host && !allowedHosts.has(host)) {
      res.status(403).json({ error: 'Host header is not allowed for local MCP vault' });
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
          res.status(403).json({ error: 'Origin is not allowed for local MCP vault' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Origin is not allowed for local MCP vault' });
        return;
      }
    }
    next();
  }
}

function keyMatches(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || expected.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal-length buffers; unequal length ⇒ no match.
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionHeader(req: Request): string | undefined {
  const value = req.header('mcp-session-id');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readServerId(req: Request): string {
  const value = req.params.serverId;
  if (typeof value !== 'string' || value.length === 0) throw new Error('Missing server id');
  return value;
}
