import { randomBytes } from 'node:crypto';
import type { ConfigRepository } from '../storage/config-repository.js';
import type { VaultProvider } from './vault-provider.js';

const MASTER_REF = 'keystore:master';
const serverRef = (id: string): string => `keystore:server:${id}`;

function generateKey(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * Stores the gateway master key and per-server access keys.
 *
 * When the OS keychain is available the keys are **sealed at rest** via the vault
 * provider; the decrypted values are cached in memory so the gateway's
 * synchronous per-request auth stays fast. The persisted (sealed) value is the
 * source of truth, so keys survive a process restart.
 *
 * Failure handling that a down→up lifecycle demands:
 * - keychain lost between runs (reveal throws) → **regenerate** the key rather
 *   than crash (the affected install JSON must be re-copied);
 * - vault blocked (no keychain / no password) → **durable plaintext** fallback so
 *   keys still survive restarts.
 */
export class KeyStore {
  private readonly cache = new Map<string, string>();
  private sealed: boolean | null = null;

  constructor(private readonly repository: ConfigRepository, private readonly vault: VaultProvider) {}

  /** Warm the cache for the master key and the given servers (call once at startup). */
  async init(serverIds: string[]): Promise<void> {
    await this.ensureMaster();
    for (const id of serverIds) await this.ensureServer(id);
  }

  master(): string {
    return this.cache.get(MASTER_REF) ?? '';
  }

  server(id: string): string | undefined {
    return this.cache.get(serverRef(id));
  }

  ensureMaster(): Promise<string> {
    return this.load(MASTER_REF);
  }

  ensureServer(id: string): Promise<string> {
    return this.load(serverRef(id));
  }

  rotateServer(id: string): Promise<string> {
    return this.regenerate(serverRef(id));
  }

  rotateMaster(): Promise<string> {
    return this.regenerate(MASTER_REF);
  }

  /** Forget a server's key (on server deletion): sealed entry, plaintext, and cache. */
  async forget(id: string): Promise<void> {
    const ref = serverRef(id);
    await this.vault.delete(ref).catch(() => undefined);
    this.repository.deleteSetting(ref);
    this.cache.delete(ref);
  }

  private async isSealed(): Promise<boolean> {
    if (this.sealed === null) this.sealed = (await this.vault.status()).canPersistSecrets;
    return this.sealed;
  }

  private async load(ref: string): Promise<string> {
    const cached = this.cache.get(ref);
    if (cached !== undefined) return cached;

    if (!(await this.isSealed())) {
      // Durable plaintext fallback (vault can't encrypt): survives restarts.
      const existing = this.repository.getSetting(ref);
      const value = existing ?? generateKey();
      if (!existing) this.repository.setSetting(ref, value);
      this.cache.set(ref, value);
      return value;
    }

    try {
      const revealed = await this.vault.reveal(ref);
      this.cache.set(ref, revealed);
      return revealed;
    } catch (error) {
      if (this.repository.getVaultEntry(ref) !== null) {
        console.warn(`[octovault] re-issuing key ${ref}: stored value could not be decrypted (${describe(error)})`);
      }
      const value = generateKey();
      await this.persistSealed(ref, value);
      this.cache.set(ref, value);
      return value;
    }
  }

  private async regenerate(ref: string): Promise<string> {
    const value = generateKey();
    if (await this.isSealed()) await this.persistSealed(ref, value);
    else this.repository.setSetting(ref, value);
    this.cache.set(ref, value);
    return value;
  }

  private async persistSealed(ref: string, value: string): Promise<void> {
    try {
      await this.vault.seal(ref, value);
      this.repository.deleteSetting(ref); // drop any plaintext remnant
    } catch (error) {
      console.warn(`[octovault] sealing key ${ref} failed, falling back to plaintext (${describe(error)})`);
      this.repository.setSetting(ref, value);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
