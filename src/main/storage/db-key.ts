import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import type { SafeStorageLike } from '../vault/vault-provider.js';

export interface DatabaseKeyOptions {
  safeStorage?: SafeStorageLike;
  password?: string;
}

/**
 * Resolves the raw 256-bit SQLCipher key (64 hex chars) for the whole-database
 * encryption, or `undefined` if no protection is available (open unencrypted).
 *
 * Preference:
 * 1. A random key sealed with the OS keychain (`safeStorage`), persisted at
 *    `keyFilePath` (0600). This survives restarts because decryption is stable.
 * 2. A key derived from `OCTOVAULT_PASSWORD` via scrypt (headless fallback).
 */
export function resolveDatabaseKey(keyFilePath: string, options: DatabaseKeyOptions): string | undefined {
  const { safeStorage, password } = options;

  if (safeStorage?.isEncryptionAvailable?.() && safeStorage.encryptString && safeStorage.decryptString) {
    if (existsSync(keyFilePath)) {
      try {
        return safeStorage.decryptString(readFileSync(keyFilePath));
      } catch {
        // Keychain can no longer decrypt the sealed key: fall through and re-issue.
        // (The old encrypted DB becomes unreadable — acceptable pre-release.)
      }
    }
    const key = randomBytes(32).toString('hex');
    mkdirSync(dirname(keyFilePath), { recursive: true });
    writeFileSync(keyFilePath, safeStorage.encryptString(key));
    try { chmodSync(keyFilePath, 0o600); } catch { /* non-POSIX */ }
    return key;
  }

  if (password) {
    return scryptSync(password, 'octovault-db-key', 32).toString('hex');
  }

  return undefined;
}
