import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { ConfigRepository } from '../storage/config-repository.js';
import type { VaultStatus } from '../../shared/types.js';

/** The insecure placeholder password shipped for local development. */
export const INSECURE_DEFAULT_PASSWORD = 'development-only-change-me';
const FALLBACK_SALT_SETTING = 'vault.fallback.salt';

/**
 * Map safeStorage's backend to a human name. Electron only reports a meaningful
 * backend string on Linux; on macOS/Windows the OS mechanism is fixed, so we
 * label it from the platform instead of the (opaque) API return value.
 */
function friendlyBackend(rawBackend: string | undefined): string {
  switch (process.platform) {
    case 'darwin': return 'macOS Keychain';
    case 'win32':  return 'Windows DPAPI';
    case 'linux':  return rawBackend && rawBackend !== 'unknown' ? rawBackend : 'Linux secret service';
    default:       return rawBackend ?? 'os-crypt';
  }
}

export interface VaultProvider {
  status(): Promise<VaultStatus>;
  seal(ref: string, plaintext: string): Promise<void>;
  reveal(ref: string): Promise<string>;
  delete(ref: string): Promise<void>;
}

export interface SafeStorageLike {
  isEncryptionAvailable?: () => boolean;
  isAsyncEncryptionAvailable?: () => Promise<boolean>;
  getSelectedStorageBackend?: () => string;
  encryptString?: (plainText: string) => Buffer;
  decryptString?: (encrypted: Buffer) => string;
  encryptStringAsync?: (plainText: string) => Promise<Buffer>;
  decryptStringAsync?: (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt?: boolean } | string>;
}

export class SafeStorageVaultProvider implements VaultProvider {
  constructor(private readonly repository: ConfigRepository, private readonly safeStorage: SafeStorageLike) {}

  async status(): Promise<VaultStatus> {
    const rawBackend = this.safeStorage.getSelectedStorageBackend?.();
    const asyncAvailable = this.safeStorage.isAsyncEncryptionAvailable ? await this.safeStorage.isAsyncEncryptionAvailable() : undefined;
    const available = asyncAvailable ?? this.safeStorage.isEncryptionAvailable?.() ?? false;
    const backend = friendlyBackend(rawBackend);
    if (!available) {
      return { backend, status: 'blocked', canPersistSecrets: false, message: 'OS-backed encryption is unavailable; secret persistence is blocked.' };
    }
    // getSelectedStorageBackend() only reports a real backend on Linux; 'basic_text'
    // means Electron found no keyring, so encryption would be trivially reversible.
    if (rawBackend === 'basic_text') {
      return { backend, status: 'blocked', canPersistSecrets: false, message: 'Electron selected Linux basic_text storage; secret persistence is blocked to avoid weak encryption.' };
    }
    return { backend, status: 'safe', canPersistSecrets: true, message: `Secrets are encrypted at rest with ${backend}.` };
  }

  async seal(ref: string, plaintext: string): Promise<void> {
    const state = await this.status();
    if (!state.canPersistSecrets) throw new Error(state.message);
    const ciphertext = await this.encrypt(plaintext);
    const now = new Date().toISOString();
    this.repository.putVaultEntry({ ref, backend: state.backend, ciphertext, createdAt: now, updatedAt: now });
  }

  async reveal(ref: string): Promise<string> {
    const entry = this.repository.getVaultEntry(ref);
    if (!entry) throw new Error(`Vault entry not found: ${ref}`);
    return this.decrypt(Buffer.from(entry.ciphertext));
  }

  async delete(ref: string): Promise<void> {
    this.repository.deleteVaultEntry(ref);
  }

  private async encrypt(plaintext: string): Promise<Uint8Array> {
    if (this.safeStorage.encryptStringAsync) return this.safeStorage.encryptStringAsync(plaintext);
    if (this.safeStorage.encryptString) return this.safeStorage.encryptString(plaintext);
    throw new Error('safeStorage does not provide an encryption method');
  }

  private async decrypt(ciphertext: Buffer): Promise<string> {
    if (this.safeStorage.decryptStringAsync) {
      const result = await this.safeStorage.decryptStringAsync(ciphertext);
      return typeof result === 'string' ? result : result.result;
    }
    if (this.safeStorage.decryptString) return this.safeStorage.decryptString(ciphertext);
    throw new Error('safeStorage does not provide a decryption method');
  }
}

export class PasswordVaultProvider implements VaultProvider {
  private readonly key: Buffer;
  private readonly isDefaultPassword: boolean;

  constructor(private readonly repository: ConfigRepository, password: string) {
    this.isDefaultPassword = password === INSECURE_DEFAULT_PASSWORD;
    // Derive the key with scrypt over a persisted per-install random salt so the
    // fallback resists offline brute force, and so ciphertext survives restarts.
    let saltHex = this.repository.getSetting(FALLBACK_SALT_SETTING);
    if (!saltHex) {
      saltHex = randomBytes(16).toString('hex');
      this.repository.setSetting(FALLBACK_SALT_SETTING, saltHex);
    }
    this.key = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  }

  async status(): Promise<VaultStatus> {
    if (this.isDefaultPassword) {
      return { backend: 'password-aes-256-gcm', status: 'blocked', canPersistSecrets: false, message: 'OS-backed encryption is unavailable and no OCTOVAULT_PASSWORD is set; secret persistence is blocked to avoid encrypting with a known default key.' };
    }
    return { backend: 'password-aes-256-gcm', status: 'degraded', canPersistSecrets: true, message: 'OS-backed encryption is unavailable; secrets use a password-derived AES-256-GCM fallback.' };
  }

  async seal(ref: string, plaintext: string): Promise<void> {
    if (this.isDefaultPassword) throw new Error('Refusing to persist secrets: set OCTOVAULT_PASSWORD to enable the encrypted fallback.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    const now = new Date().toISOString();
    this.repository.putVaultEntry({ ref, backend: 'password-aes-256-gcm', ciphertext: payload, createdAt: now, updatedAt: now });
  }

  async reveal(ref: string): Promise<string> {
    const entry = this.repository.getVaultEntry(ref);
    if (!entry) throw new Error(`Vault entry not found: ${ref}`);
    const payload = Buffer.from(entry.ciphertext);
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  async delete(ref: string): Promise<void> {
    this.repository.deleteVaultEntry(ref);
  }
}
