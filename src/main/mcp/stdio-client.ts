import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { McpServerWithEnv } from '../../shared/types.js';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** A server→client message (notification, or a request the server makes of the client). */
export type ServerMessage = Record<string, unknown>;
export type ServerMessageListener = (message: ServerMessage) => void;

export class StdioMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private pending = new Map<string | number, PendingCall>();
  private listeners = new Set<ServerMessageListener>();

  constructor(private readonly server: McpServerWithEnv, private readonly env: Record<string, string>, private readonly timeoutMs = 30_000) {}

  /** Subscribe to server→client messages (notifications / server-initiated requests). */
  onMessage(listener: ServerMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(message: unknown): Promise<unknown> {
    const record = assertJsonRpcWithId(message);
    await this.ensureStarted();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(record.id);
        reject(new Error(`MCP stdio request timed out for ${this.server.id}`));
      }, this.timeoutMs);
      this.pending.set(record.id, { resolve, reject, timer });
      this.child?.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async notify(message: unknown): Promise<void> {
    await this.ensureStarted();
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  health(): { ok: boolean; message: string } {
    if (!this.server.enabled) return { ok: false, message: 'Server disabled' };
    if (!this.child) return { ok: true, message: 'Ready; process starts on first request' };
    if (this.child.exitCode !== null) return { ok: false, message: `Process exited with code ${this.child.exitCode}` };
    return { ok: true, message: 'Process running' };
  }

  stop(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`MCP stdio client stopped before response for ${String(id)}`));
    }
    this.pending.clear();
    this.listeners.clear();
    this.lines?.close();
    this.lines = null;
    this.child?.kill();
    this.child = null;
  }

  private async ensureStarted(): Promise<void> {
    if (!this.server.enabled) throw new Error(`MCP server ${this.server.id} is disabled`);
    if (this.server.transport !== 'stdio') throw new Error(`MCP server ${this.server.id} is not stdio`);
    if (!this.server.command) throw new Error(`MCP server ${this.server.id} has no command`);
    if (this.child && this.child.exitCode === null) return;

    this.child = spawn(this.server.command, this.server.args, {
      cwd: this.server.cwd ?? undefined,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) console.warn(`[mcp:${this.server.id}:stderr] ${text}`);
    });
    this.child.on('exit', (code) => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP process ${this.server.id} exited before response ${String(id)} (code ${code})`));
      }
      this.pending.clear();
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => this.handleLine(line));
  }

  private handleLine(line: string): void {
    let message: { id?: string | number; method?: unknown; result?: unknown; error?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      console.warn(`[mcp:${this.server.id}] ignored non-JSON stdout line`);
      return;
    }

    // A message carrying a `method` is server→client (notification or request),
    // even when it has an id. Everything else with a matching id is a response.
    if (typeof message.method === 'string') {
      for (const listener of this.listeners) listener(message as ServerMessage);
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve(message);
  }
}

function assertJsonRpcWithId(message: unknown): { id: string | number } {
  if (!message || typeof message !== 'object') throw new Error('JSON-RPC message must be an object');
  const id = (message as { id?: unknown }).id;
  if (typeof id !== 'string' && typeof id !== 'number') throw new Error('JSON-RPC requests require a string or number id');
  return { id };
}
