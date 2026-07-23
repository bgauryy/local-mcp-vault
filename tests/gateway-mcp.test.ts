import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { ConfigRepository } from '../src/main/storage/config-repository.js';
import { McpConfigService } from '../src/main/vault/env-service.js';
import { PasswordVaultProvider } from '../src/main/vault/vault-provider.js';
import { McpRuntime } from '../src/main/mcp/mcp-runtime.js';
import { LocalGateway } from '../src/main/gateway/local-gateway.js';

const ECHO = fileURLToPath(new URL('../fixtures/echo-mcp.mjs', import.meta.url));

async function harness() {
  const repository = new ConfigRepository(':memory:');
  const vault = new PasswordVaultProvider(repository, 'test-password');
  const service = new McpConfigService(repository, vault, 'http://127.0.0.1:0');
  const runtime = new McpRuntime(service);
  const gateway = new LocalGateway(service, runtime, { port: 0, accessKey: 'master-key' });
  await service.saveServer({ id: 'echo', name: 'Echo', transport: 'stdio', command: process.execPath, args: [ECHO], enabled: true });
  const server = gateway.app().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const teardown = async () => {
    runtime.stop();
    await new Promise<void>((resolve, reject) => (server as Server).close((e) => (e ? reject(e) : resolve())));
    repository.close();
  };
  return { service, port, teardown };
}

function post(port: number, body: unknown, key = 'master-key') {
  return fetch(`http://127.0.0.1:${port}/mcp/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-octovault-key': key },
    body: JSON.stringify(body)
  });
}

test('MCP request returns a JSON-RPC response; initialize sets Mcp-Session-Id', async () => {
  const { port, teardown } = await harness();
  try {
    const res = await post(port, { jsonrpc: '2.0', id: 1, method: 'tools/call' });
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { id: number }).id, 1);

    const init = await post(port, { jsonrpc: '2.0', id: 0, method: 'initialize' });
    assert.ok(init.headers.get('mcp-session-id'), 'initialize response carries a session id');
  } finally {
    await teardown();
  }
});

test('notification-only POST returns 202 with no body', async () => {
  const { port, teardown } = await harness();
  try {
    const res = await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(res.status, 202);
    assert.equal((await res.text()).length, 0);
  } finally {
    await teardown();
  }
});

test('JSON-RPC batch returns responses only for the request entries', async () => {
  const { port, teardown } = await harness();
  try {
    const res = await post(port, [
      { jsonrpc: '2.0', id: 5, method: 'tools/list' },
      { jsonrpc: '2.0', method: 'notifications/progress' }
    ]);
    assert.equal(res.status, 200);
    const body = await res.json() as Array<{ id: number }>;
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0]?.id, 5);
  } finally {
    await teardown();
  }
});

test('per-server access key is accepted and the wrong key is rejected', async () => {
  const { service, port, teardown } = await harness();
  try {
    const serverKey = service.getServerAccessKey('echo');
    assert.notEqual(serverKey, 'master-key');

    const ok = await post(port, { jsonrpc: '2.0', id: 3, method: 'x' }, serverKey);
    assert.equal(ok.status, 200);

    const bad = await post(port, { jsonrpc: '2.0', id: 3, method: 'x' }, 'not-the-key');
    assert.equal(bad.status, 401);
  } finally {
    await teardown();
  }
});
