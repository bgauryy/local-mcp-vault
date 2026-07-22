import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigRepository } from '../src/main/storage/config-repository.js';
import { McpConfigService } from '../src/main/vault/env-service.js';
import { PasswordVaultProvider } from '../src/main/vault/vault-provider.js';

test('stores reusable vault secrets and maps MCP env vars by vault key', async () => {
  const repository = new ConfigRepository(':memory:');
  const vault = new PasswordVaultProvider(repository, 'test-password');
  const service = new McpConfigService(repository, vault, 'http://127.0.0.1:1987');

  const secret = await service.saveVaultSecret({ key: 'GITHUB_TOKEN', value: 'super-secret-token' });
  const saved = await service.saveServer({
    id: 'github-tools',
    name: 'GitHub Tools',
    transport: 'stdio',
    command: 'node',
    args: ['fixtures/echo-mcp.mjs'],
    enabled: true,
    env: [
      { key: 'GITHUB_TOKEN', vaultKey: 'GITHUB_TOKEN', isSecret: true },
      { key: 'LOG_LEVEL', value: 'debug', isSecret: false }
    ]
  });

  assert.deepEqual(service.listVaultSecrets().map(({ key }) => key), ['GITHUB_TOKEN']);
  assert.equal(saved.env.find((env) => env.key === 'GITHUB_TOKEN')?.value, null);
  assert.equal(saved.env.find((env) => env.key === 'GITHUB_TOKEN')?.vaultKey, 'GITHUB_TOKEN');
  assert.equal(saved.env.find((env) => env.key === 'GITHUB_TOKEN')?.secretRef, secret.secretRef);
  assert.equal(saved.env.find((env) => env.key === 'LOG_LEVEL')?.value, 'debug');
  assert.deepEqual(await service.resolveEnv(saved), { GITHUB_TOKEN: 'super-secret-token', LOG_LEVEL: 'debug' });
  repository.close();
});

test('deleting server keeps reusable vault secrets', async () => {
  const repository = new ConfigRepository(':memory:');
  const vault = new PasswordVaultProvider(repository, 'test-password');
  const service = new McpConfigService(repository, vault, 'http://127.0.0.1:1987');
  const secret = await service.saveVaultSecret({ key: 'API_TOKEN', value: 'secret' });
  await service.saveServer({ id: 'delete-me', name: 'Delete Me', transport: 'stdio', command: 'node', enabled: true, env: [{ key: 'API_TOKEN', vaultKey: 'API_TOKEN', isSecret: true }] });
  await service.deleteServer('delete-me');
  assert.ok(repository.getVaultEntry(secret.secretRef));
  assert.deepEqual(service.listVaultSecrets().map(({ key }) => key), ['API_TOKEN']);
  repository.close();
});

test('deleting vault secret removes its sealed value', async () => {
  const repository = new ConfigRepository(':memory:');
  const vault = new PasswordVaultProvider(repository, 'test-password');
  const service = new McpConfigService(repository, vault, 'http://127.0.0.1:1987');
  const secret = await service.saveVaultSecret({ key: 'API_TOKEN', value: 'secret' });
  await service.deleteVaultSecret('API_TOKEN');
  assert.equal(repository.getVaultEntry(secret.secretRef), null);
  assert.deepEqual(service.listVaultSecrets(), []);
  repository.close();
});

test('records MCP usage metrics with token estimates and errors', async () => {
  const repository = new ConfigRepository(':memory:');
  const vault = new PasswordVaultProvider(repository, 'test-password');
  const service = new McpConfigService(repository, vault, 'http://127.0.0.1:1987');
  await service.saveServer({ id: 'metrics-server', name: 'Metrics Server', transport: 'stdio', command: 'node', enabled: true });

  repository.recordUsage('metrics-server', { method: 'tools/call', estimatedTokens: 42, ok: true });
  repository.recordUsage('metrics-server', { method: 'prompts/list', estimatedTokens: 8, ok: false });

  const server = service.getServer('metrics-server');
  assert.equal(server?.usage.requestCount, 2);
  assert.equal(server?.usage.toolCallCount, 1);
  assert.equal(server?.usage.estimatedTokenCount, 50);
  assert.equal(server?.usage.errorCount, 1);
  assert.ok(server?.usage.lastCalledAt);
  repository.close();
});
