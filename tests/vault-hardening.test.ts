import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigRepository } from '../src/main/storage/config-repository.js';
import { PasswordVaultProvider, INSECURE_DEFAULT_PASSWORD } from '../src/main/vault/vault-provider.js';
import { AppServices } from '../src/main/app-services.js';

test('fallback vault refuses to persist under the insecure default password', async () => {
  const repository = new ConfigRepository(':memory:');
  const vault = new PasswordVaultProvider(repository, INSECURE_DEFAULT_PASSWORD);

  const status = await vault.status();
  assert.equal(status.status, 'blocked');
  assert.equal(status.canPersistSecrets, false);
  await assert.rejects(() => vault.seal('vault:X:1', 'secret'), /OCTOVAULT_PASSWORD/);

  repository.close();
});

test('fallback vault seals and reveals across provider instances via a persisted salt', async () => {
  const repository = new ConfigRepository(':memory:');
  const first = new PasswordVaultProvider(repository, 'a-real-password');
  await first.seal('vault:TOKEN:1', 'super-secret');

  // A fresh provider on the same repository must derive the same key (same salt).
  const second = new PasswordVaultProvider(repository, 'a-real-password');
  assert.equal(await second.reveal('vault:TOKEN:1'), 'super-secret');

  // A different password must NOT decrypt (auth tag mismatch).
  const wrong = new PasswordVaultProvider(repository, 'different-password');
  await assert.rejects(() => wrong.reveal('vault:TOKEN:1'));

  repository.close();
});

test('gateway access key is persisted and reused across app restarts', async () => {
  const storageRoot = join(tmpdir(), `octovault-test-${randomUUID()}`);
  try {
    const first = new AppServices({ storageRoot, fallbackPassword: 'a-real-password', gatewayPort: 0 });
    await first.start(); // master key is sealed + seeded during start
    const keyA = first.gateway.config.accessKey;
    await first.stop();

    const second = new AppServices({ storageRoot, fallbackPassword: 'a-real-password', gatewayPort: 0 });
    await second.start();
    const keyB = second.gateway.config.accessKey;
    await second.stop();

    assert.equal(keyA, keyB);
    assert.ok(keyA.length > 0);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test('vault store is created with owner-only permissions', { skip: process.platform === 'win32' }, async () => {
  const storageRoot = join(tmpdir(), `octovault-test-${randomUUID()}`);
  try {
    const services = new AppServices({ storageRoot, fallbackPassword: 'a-real-password', gatewayPort: 0 });
    await services.stop();

    // Directory: no group/other access; DB file: owner read/write only.
    assert.equal(statSync(storageRoot).mode & 0o077, 0);
    assert.equal(statSync(join(storageRoot, 'vault.db')).mode & 0o777, 0o600);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
