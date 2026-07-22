import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { McpConfigService } from '../vault/env-service.js';
import type { McpRuntime } from '../mcp/mcp-runtime.js';
import type { ClientConfigSnippet, GatewayConfig } from '../../shared/types.js';
import { redactRecord } from '../../shared/redaction.js';

export interface LocalGatewayOptions {
  port?: number;
  accessKey?: string;
}

export class LocalGateway {
  private server: Server | null = null;
  readonly config: GatewayConfig;

  constructor(private readonly configService: McpConfigService, private readonly runtime: McpRuntime, options: LocalGatewayOptions = {}) {
    this.config = {
      host: '127.0.0.1',
      port: options.port ?? Number(process.env.OCTOVAULT_PORT ?? 1987),
      accessKey: options.accessKey ?? randomBytes(24).toString('base64url')
    };
  }

  app() {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '2mb' }));
    app.use(this.hostOriginGuard.bind(this));

    app.get('/status', (_req, res) => {
      res.json({ ok: true, host: this.config.host, port: this.config.port, servers: this.configService.listServers().length });
    });

    app.get('/servers', this.accessKeyGuard.bind(this), (_req, res) => {
      res.json(this.publicServers());
    });

    app.get('/health/:serverId', this.accessKeyGuard.bind(this), (req, res) => {
      const serverId = readServerId(req);
      res.json(this.runtime.health(serverId));
    });

    app.get('/config/:serverId', this.accessKeyGuard.bind(this), (req, res) => {
      const serverId = readServerId(req);
      const server = this.configService.getServer(serverId);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      const snippet: ClientConfigSnippet = {
        mcpServers: {
          [server.id]: {
            transport: 'streamableHttp',
            url: this.localMcpUrl(server.id),
            headers: { 'x-octovault-key': this.config.accessKey }
          }
        }
      };
      return res.json(snippet);
    });

    app.all('/mcp/:serverId', this.accessKeyGuard.bind(this), async (req, res, next) => {
      try {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST is implemented in the MVP gateway' });
        const result = await this.runtime.handle(readServerId(req), req.body);
        return res.json(result);
      } catch (error) {
        return next(error);
      }
    });

    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const message = error instanceof Error ? error.message : 'Unknown gateway error';
      res.status(500).json(redactRecord({ error: message }));
    });
    return app;
  }

  async start(): Promise<GatewayConfig> {
    if (this.server) return this.config;
    const app = this.app();
    await new Promise<void>((resolve, reject) => {
      const server = app.listen(this.config.port, this.config.host, () => resolve());
      server.once('error', reject);
      this.server = server;
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
    return `http://${this.config.host}:${this.config.port}/mcp/${encodeURIComponent(serverId)}`;
  }

  private publicServers() {
    return this.configService.listServers().map((server) => ({
      ...server,
      env: server.env.map((env) => ({ ...env, value: env.isSecret ? null : env.value }))
    }));
  }

  private accessKeyGuard(req: Request, res: Response, next: NextFunction): void {
    if (req.header('x-octovault-key') !== this.config.accessKey) {
      res.status(401).json({ error: 'Missing or invalid OctoVault access key' });
      return;
    }
    next();
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

function readServerId(req: Request): string {
  const value = req.params.serverId;
  if (typeof value !== 'string' || value.length === 0) throw new Error('Missing server id');
  return value;
}
