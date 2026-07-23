import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigRepository } from '../src/main/storage/config-repository.js';
import { PasswordVaultProvider } from '../src/main/vault/vault-provider.js';
import { KeyStore } from '../src/main/vault/key-store.js';
import type { VaultProvider } from '../src/main/vault/vault-provider.js';
import type { VaultStatus } from '../src/shared/types.js';

/** A vault whose reveal can be made to fail, to simulate a lost keychain across restarts. */
class FlakyVault implements VaultProvider {
  private store = new Map<string, string>();
  failReveal = false;
  canPersist = true;
  async status(): Promise<VaultStatus> {
    return { backend: 'flaky', status: this.canPersist ? 'safe' : 'blocked', canPersistSecrets: this.canPersist, message: '' };
  }
  async seal(ref: string, plaintext: string): Promise<void> {
    if (!this.canPersist) throw new Error('blocked');
    this.store.set(ref, plaintext);
  }
  async reveal(ref: string): Promise<string> {
    if (this.failReveal) throw new Error('keychain unavailable');
    const v = this.store.get(ref);
    if (v === undefined) throw new Error('not found');
    return v;
  }
  async delete(ref: string): Promise<void> { this.store.delete(ref); }
}

test('server key is sealed and reveals the same value across restarts', async () => {
  const repo = new ConfigRepository(':memory:');
  const vault = new PasswordVaultProvider(repo, 'pw');
  const k1 = await new KeyStore(repo, vault).ensureServer('alpha');
  assert.ok(k1.length > 0);

  // A fresh KeyStore on the same repo (a "restart") must recover the same key.
  const store2 = new KeyStore(repo, new PasswordVaultProvider(repo, 'pw'));
  assert.equal(store2.server('alpha'), undefined, 'cache is cold before init');
  assert.equal(await store2.ensureServer('alpha'), k1);
  assert.equal(store2.server('alpha'), k1, 'sync read works after ensure');
  repo.close();
});

test('rotate changes the key and the new value persists', async () => {
  const repo = new ConfigRepository(':memory:');
  const store = new KeyStore(repo, new PasswordVaultProvider(repo, 'pw'));
  const before = await store.ensureServer('alpha');
  const after = await store.rotateServer('alpha');
  assert.notEqual(after, before);
  assert.equal(await new KeyStore(repo, new PasswordVaultProvider(repo, 'pw')).ensureServer('alpha'), after);
  repo.close();
});

test('decrypt failure across a restart regenerates the key instead of crashing', async () => {
  const repo = new ConfigRepository(':memory:');
  const vault = new FlakyVault();
  const k1 = await new KeyStore(repo, vault).ensureServer('alpha');

  // Next boot: the keychain can no longer decrypt → KeyStore must rotate, not throw.
  vault.failReveal = true;
  const k2 = await new KeyStore(repo, vault).ensureServer('alpha');
  assert.ok(k2.length > 0);
  assert.notEqual(k2, k1);
  repo.close();
});

test('blocked vault falls back to durable plaintext so keys survive restarts', async () => {
  const repo = new ConfigRepository(':memory:');
  const vault = new FlakyVault();
  vault.canPersist = false;
  const k1 = await new KeyStore(repo, vault).ensureServer('alpha');
  assert.ok(k1.length > 0);
  // Stored in the repo (plaintext) and stable on the next boot.
  const k2 = await new KeyStore(repo, vault).ensureServer('alpha');
  assert.equal(k2, k1);
  repo.close();
});
