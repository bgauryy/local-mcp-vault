import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { ConfigRepository } from '../src/main/storage/config-repository.js';
import { McpConfigService } from '../src/main/vault/env-service.js';
import { PasswordVaultProvider } from '../src/main/vault/vault-provider.js';
import { McpRuntime } from '../src/main/mcp/mcp-runtime.js';
import { LocalGateway } from '../src/main/gateway/local-gateway.js';

test('gateway rejects missing key and bad origin before MCP handling', async () => {
  const repository = new ConfigRepository(':memory:');
  const vault = new PasswordVaultProvider(repository, 'test-password');
  const service = new McpConfigService(repository, vault, 'http://127.0.0.1:0');
  const runtime = new McpRuntime(service);
  const gateway = new LocalGateway(service, runtime, { port: 0, accessKey: 'test-key' });
  const app = gateway.app();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.ok(address);
  const port = (address as AddressInfo).port;

  const missingKey = await fetch(`http://127.0.0.1:${port}/servers`);
  assert.equal(missingKey.status, 401);

  const badOrigin = await fetch(`http://127.0.0.1:${port}/servers`, { headers: { 'x-octovault-key': 'test-key', origin: 'https://evil.example' } });
  assert.equal(badOrigin.status, 403);

  const ok = await fetch(`http://127.0.0.1:${port}/servers`, { headers: { 'x-octovault-key': 'test-key' } });
  assert.equal(ok.status, 200);

  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  repository.close();
});
