import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigRepository } from '../src/main/storage/config-repository.js';

// Whole-database (SQLCipher) encryption. Requires the native driver, so these
// run wherever `better-sqlite3-multiple-ciphers` is installed (Node ABI in CI).

function tempDbPath(): string {
  return join(tmpdir(), `octovault-db-${randomUUID()}`, 'vault.db');
}

test('an existing plaintext database is encrypted in place when a database key becomes available', () => {
  const dbPath = tempDbPath();
  const key = randomBytes(32).toString('hex');
  try {
    const plain = new ConfigRepository(dbPath);
    plain.upsertServer({ id: 'legacy-server', name: 'LEGACY_NAME', transport: 'stdio', command: 'node', enabled: true });
    plain.close();

    assert.equal(readFileSync(dbPath).subarray(0, 16).toString('utf8').startsWith('SQLite format 3'), true, 'starts as plaintext SQLite');

    const encrypted = new ConfigRepository(dbPath, key);
    assert.equal(encrypted.getServer('legacy-server')?.name, 'LEGACY_NAME');
    encrypted.close();

    const raw = readFileSync(dbPath);
    assert.equal(raw.includes(Buffer.from('LEGACY_NAME')), false, 'legacy data is encrypted in place');
    assert.equal(raw.subarray(0, 16).toString('utf8').startsWith('SQLite format 3'), false, 'header is encrypted after migration');
  } finally {
    rmSync(join(dbPath, '..'), { recursive: true, force: true });
  }
});

test('an encrypted database is unreadable without the key and readable with it', () => {
  const dbPath = tempDbPath();
  const key = randomBytes(32).toString('hex');
  try {
    const repo = new ConfigRepository(dbPath, key);
    repo.upsertServer({ id: 'recognizable-server', name: 'RECOGNIZABLE_NAME', transport: 'stdio', command: 'node', enabled: true });
    repo.close();

    // The raw file must not contain our plaintext name.
    const raw = readFileSync(dbPath);
    assert.equal(raw.includes(Buffer.from('RECOGNIZABLE_NAME')), false, 'server name is ciphertext on disk');
    assert.equal(raw.subarray(0, 16).toString('utf8').startsWith('SQLite format 3'), false, 'header is not a plaintext SQLite header');

    // Reopening with the right key works.
    const reopened = new ConfigRepository(dbPath, key);
    assert.equal(reopened.getServer('recognizable-server')?.name, 'RECOGNIZABLE_NAME');
    reopened.close();

    // Reopening with the wrong key fails.
    assert.throws(() => {
      const wrong = new ConfigRepository(dbPath, randomBytes(32).toString('hex'));
      wrong.listServers();
    });
  } finally {
    rmSync(join(dbPath, '..'), { recursive: true, force: true });
  }
});
