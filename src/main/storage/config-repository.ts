import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database, { type BetterSqlite3Database } from 'better-sqlite3-multiple-ciphers';
import type { McpServerInput, McpServerRecord, McpServerWithEnv, McpUsageMetrics, VaultEntryRecord, VaultSecretRecord } from '../../shared/types.js';
import { makeServerId, parseMcpServerInput } from '../../shared/validation.js';

interface ServerRow {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  args_json: string;
  url: string | null;
  cwd: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface EnvRow {
  server_id: string;
  key: string;
  is_secret: number;
  value: string | null;
  secret_ref: string | null;
  vault_key: string | null;
}

interface VaultRow {
  ref: string;
  backend: string;
  ciphertext: Uint8Array;
  created_at: string;
  updated_at: string;
}

interface UsageRow {
  server_id: string;
  request_count: number;
  tool_call_count: number;
  estimated_token_count: number;
  error_count: number;
  last_called_at: string | null;
}

interface VaultSecretRow {
  key: string;
  secret_ref: string;
  created_at: string;
  updated_at: string;
}

export interface UsageEvent {
  method?: string;
  estimatedTokens: number;
  ok: boolean;
}

function restrictPermissions(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch (error) {
    console.warn(`[octovault] could not restrict permissions on ${path}`, error);
  }
}

function keyPragma(encryptionKey: string): string {
  return `key = "x'${encryptionKey}'"`;
}

function rekeyPragma(encryptionKey: string): string {
  return `rekey = "x'${encryptionKey}'"`;
}

function isNotDatabaseError(error: unknown): boolean {
  return error instanceof Error && /file is not a database/i.test(error.message);
}

function canOpenPlaintextDatabase(databasePath: string): boolean {
  let db: BetterSqlite3Database | undefined;
  try {
    db = new Database(databasePath);
    db.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
    return true;
  } catch {
    return false;
  } finally {
    if (db) db.close();
  }
}

function encryptExistingPlaintextDatabase(databasePath: string, encryptionKey: string): void {
  const db = new Database(databasePath);
  try {
    // Pull any WAL contents into the main plaintext DB before rekeying, then
    // leave WAL mode disabled until the keyed connection below enables it.
    db.pragma('wal_checkpoint(FULL)');
    db.pragma('journal_mode = DELETE');
    db.pragma(rekeyPragma(encryptionKey));
  } finally {
    db.close();
  }
}

export class ConfigRepository {
  private readonly db: BetterSqlite3Database;

  /**
   * @param databasePath  path to the SQLite file, or ':memory:'.
   * @param encryptionKey raw 64-hex SQLCipher key. When set, the **entire
   *   database file is encrypted at rest** (all configuration — names, commands,
   *   env values, sealed secrets — is ciphertext on disk).
   */
  constructor(databasePath = ':memory:', encryptionKey?: string) {
    if (databasePath !== ':memory:') {
      const dir = dirname(databasePath);
      mkdirSync(dir, { recursive: true });
      // Defense in depth on top of file encryption: keep the store owner-only.
      restrictPermissions(dir, 0o700);
    }
    this.db = this.openDatabase(databasePath, encryptionKey);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    if (databasePath !== ':memory:') restrictPermissions(databasePath, 0o600);
    this.migrate();
  }

  private openDatabase(databasePath: string, encryptionKey?: string): BetterSqlite3Database {
    const db = new Database(databasePath);
    if (!encryptionKey) return db;

    // The key PRAGMA must run before any other statement touches an encrypted DB.
    db.pragma(keyPragma(encryptionKey));
    try {
      // Force SQLCipher to validate the key now. Without this, errors surface
      // later during migration as the opaque SQLite message "file is not a database".
      db.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
      return db;
    } catch (error) {
      db.close();

      // Upgrade path for stores created before whole-database encryption existed:
      // if the existing file is valid plaintext SQLite, encrypt it in place with
      // the new key and reopen it as an encrypted database.
      if (databasePath !== ':memory:' && existsSync(databasePath) && isNotDatabaseError(error) && canOpenPlaintextDatabase(databasePath)) {
        encryptExistingPlaintextDatabase(databasePath, encryptionKey);
        const encryptedDb = new Database(databasePath);
        encryptedDb.pragma(keyPragma(encryptionKey));
        encryptedDb.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
        return encryptedDb;
      }

      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  }

  upsertServer(input: McpServerInput): McpServerWithEnv {
    const parsed = parseMcpServerInput(input);
    const id = parsed.id ?? makeServerId(parsed.name);
    const now = new Date().toISOString();
    const existing = this.getServerRecord(id);
    const insert = this.db.prepare(`
      INSERT INTO mcp_servers (id, name, transport, command, args_json, url, cwd, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        transport = excluded.transport,
        command = excluded.command,
        args_json = excluded.args_json,
        url = excluded.url,
        cwd = excluded.cwd,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `);
    insert.run(
      id,
      parsed.name,
      parsed.transport,
      parsed.command ?? null,
      JSON.stringify(parsed.args ?? []),
      parsed.url ?? null,
      parsed.cwd ?? null,
      parsed.enabled ? 1 : 0,
      existing?.createdAt ?? now,
      now
    );

    this.db.prepare('DELETE FROM mcp_env_vars WHERE server_id = ?').run(id);
    const insertEnv = this.db.prepare('INSERT INTO mcp_env_vars (server_id, key, is_secret, value, secret_ref, vault_key) VALUES (?, ?, ?, ?, ?, ?)');
    for (const env of parsed.env ?? []) {
      // Secret values live only as sealed refs; non-secret values are stored as
      // columns (the whole DB file is encrypted at rest).
      insertEnv.run(id, env.key, env.isSecret ? 1 : 0, env.isSecret ? null : env.value ?? null, env.secretRef ?? null, env.vaultKey ?? null);
    }
    return this.getServer(id) ?? (() => { throw new Error(`Failed to load saved MCP server ${id}`); })();
  }

  listServers(gatewayBaseUrl = ''): McpServerWithEnv[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY name ASC').all() as unknown as ServerRow[];
    return rows.map((row) => this.hydrateServer(row, gatewayBaseUrl));
  }

  getServer(id: string, gatewayBaseUrl = ''): McpServerWithEnv | null {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as ServerRow | undefined;
    return row ? this.hydrateServer(row, gatewayBaseUrl) : null;
  }

  deleteServer(id: string): string[] {
    const refs = (this.db.prepare('SELECT secret_ref FROM mcp_env_vars WHERE server_id = ? AND secret_ref IS NOT NULL AND vault_key IS NULL').all(id) as unknown as Array<{ secret_ref: string }>).map((row) => row.secret_ref);
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    return refs;
  }

  recordUsage(serverId: string, event: UsageEvent): void {
    const now = new Date().toISOString();
    const isToolCall = event.method === 'tools/call' ? 1 : 0;
    this.db.prepare(`
      INSERT INTO mcp_usage_metrics (server_id, request_count, tool_call_count, estimated_token_count, error_count, last_called_at)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET
        request_count = request_count + 1,
        tool_call_count = tool_call_count + excluded.tool_call_count,
        estimated_token_count = estimated_token_count + excluded.estimated_token_count,
        error_count = error_count + excluded.error_count,
        last_called_at = excluded.last_called_at
    `).run(serverId, isToolCall, Math.max(0, Math.trunc(event.estimatedTokens)), event.ok ? 0 : 1, now);
  }

  putVaultEntry(entry: VaultEntryRecord): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO vault_entries (ref, backend, ciphertext, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ref) DO UPDATE SET backend = excluded.backend, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at
    `).run(entry.ref, entry.backend, entry.ciphertext, entry.createdAt || now, now);
  }

  getVaultEntry(ref: string): VaultEntryRecord | null {
    const row = this.db.prepare('SELECT * FROM vault_entries WHERE ref = ?').get(ref) as VaultRow | undefined;
    if (!row) return null;
    return {
      ref: row.ref,
      backend: row.backend,
      ciphertext: row.ciphertext,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  deleteVaultEntry(ref: string): void {
    this.db.prepare('DELETE FROM vault_entries WHERE ref = ?').run(ref);
  }

  listVaultSecrets(): VaultSecretRecord[] {
    const rows = this.db.prepare('SELECT * FROM vault_secrets ORDER BY key ASC').all() as unknown as VaultSecretRow[];
    return rows.map((row) => ({ key: row.key, secretRef: row.secret_ref, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  getVaultSecret(key: string): VaultSecretRecord | null {
    const row = this.db.prepare('SELECT * FROM vault_secrets WHERE key = ?').get(key) as VaultSecretRow | undefined;
    return row ? { key: row.key, secretRef: row.secret_ref, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  putVaultSecret(key: string, secretRef: string): VaultSecretRecord {
    const now = new Date().toISOString();
    const existing = this.getVaultSecret(key);
    this.db.prepare(`
      INSERT INTO vault_secrets (key, secret_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET secret_ref = excluded.secret_ref, updated_at = excluded.updated_at
    `).run(key, secretRef, existing?.createdAt ?? now, now);
    return this.getVaultSecret(key) ?? (() => { throw new Error(`Failed to store vault secret ${key}`); })();
  }

  deleteVaultSecret(key: string): string | null {
    const existing = this.getVaultSecret(key);
    if (!existing) return null;
    this.db.prepare('DELETE FROM vault_secrets WHERE key = ?').run(key);
    return existing.secretRef;
  }

  createSecretRef(serverId: string, key: string): string {
    return `mcp:${serverId}:${key}:${randomUUID()}`;
  }

  createVaultSecretRef(key: string): string {
    return `vault:${key}:${randomUUID()}`;
  }

  private getServerRecord(id: string): McpServerRecord | null {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as ServerRow | undefined;
    return row ? this.rowToServer(row) : null;
  }

  private hydrateServer(row: ServerRow, gatewayBaseUrl: string): McpServerWithEnv {
    const envRows = this.db.prepare('SELECT * FROM mcp_env_vars WHERE server_id = ? ORDER BY key ASC').all(row.id) as unknown as EnvRow[];
    return {
      ...this.rowToServer(row),
      env: envRows.map((env) => ({
        serverId: env.server_id,
        key: env.key,
        isSecret: env.is_secret === 1,
        value: env.value,
        secretRef: env.secret_ref,
        vaultKey: env.vault_key
      })),
      localUrl: gatewayBaseUrl ? `${gatewayBaseUrl.replace(/\/$/, '')}/mcp/${encodeURIComponent(row.id)}` : `/mcp/${encodeURIComponent(row.id)}`,
      usage: this.getUsage(row.id)
    };
  }

  private getUsage(serverId: string): McpUsageMetrics {
    const row = this.db.prepare('SELECT * FROM mcp_usage_metrics WHERE server_id = ?').get(serverId) as UsageRow | undefined;
    return row ? {
      requestCount: row.request_count,
      toolCallCount: row.tool_call_count,
      estimatedTokenCount: row.estimated_token_count,
      errorCount: row.error_count,
      lastCalledAt: row.last_called_at
    } : { requestCount: 0, toolCallCount: 0, estimatedTokenCount: 0, errorCount: 0, lastCalledAt: null };
  }

  private rowToServer(row: ServerRow): McpServerRecord {
    return {
      id: row.id,
      name: row.name,
      transport: row.transport,
      command: row.command,
      args: JSON.parse(row.args_json) as string[],
      url: row.url,
      cwd: row.cwd,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
        command TEXT,
        args_json TEXT NOT NULL DEFAULT '[]',
        url TEXT,
        cwd TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_env_vars (
        server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        is_secret INTEGER NOT NULL DEFAULT 1,
        value TEXT,
        secret_ref TEXT,
        vault_key TEXT,
        PRIMARY KEY (server_id, key)
      );
      CREATE TABLE IF NOT EXISTS vault_secrets (
        key TEXT PRIMARY KEY,
        secret_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vault_entries (
        ref TEXT PRIMARY KEY,
        backend TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        subject_id TEXT,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS mcp_usage_metrics (
        server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
        request_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        estimated_token_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        last_called_at TEXT
      );
      INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, datetime('now'));
    `);
    this.ensureColumn('mcp_env_vars', 'vault_key', 'TEXT');
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
    if (!rows.some((row) => row.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
