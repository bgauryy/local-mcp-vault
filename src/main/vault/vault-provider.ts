import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { ConfigRepository } from '../storage/config-repository.js';
import type { VaultStatus } from '../../shared/types.js';

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
    const backend = this.safeStorage.getSelectedStorageBackend?.() ?? 'os-crypt';
    const asyncAvailable = this.safeStorage.isAsyncEncryptionAvailable ? await this.safeStorage.isAsyncEncryptionAvailable() : undefined;
    const available = asyncAvailable ?? this.safeStorage.isEncryptionAvailable?.() ?? false;
    if (!available) {
      return { backend, status: 'blocked', canPersistSecrets: false, message: 'OS-backed encryption is unavailable; secret persistence is blocked.' };
    }
    if (backend === 'basic_text') {
      return { backend, status: 'blocked', canPersistSecrets: false, message: 'Electron selected Linux basic_text storage; secret persistence is blocked to avoid weak encryption.' };
    }
    return { backend, status: 'safe', canPersistSecrets: true, message: `Secrets are encrypted with ${backend}.` };
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

  constructor(private readonly repository: ConfigRepository, password: string) {
    this.key = createHash('sha256').update(password).digest();
  }

  async status(): Promise<VaultStatus> {
    return { backend: 'password-aes-256-gcm', status: 'degraded', canPersistSecrets: true, message: 'Secrets are encrypted with a user-provided password fallback.' };
  }

  async seal(ref: string, plaintext: string): Promise<void> {
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
