import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardMetrics, buildEditForm, envDraftsFromServer, envDraftsToInput, filterServers, withOptionalField } from '../src/renderer/app-model.js';
import type { McpServerWithEnv } from '../src/shared/types.js';

test('converts env parameter rows to vault or plain env inputs', () => {
  assert.deepEqual(envDraftsToInput([
    { id: '1', key: 'TOKEN', mode: 'vault', vaultKey: 'GITHUB_TOKEN', value: '' },
    { id: '2', key: 'LOG_LEVEL', mode: 'plain', vaultKey: '', value: 'debug' },
    { id: '3', key: '', mode: 'vault', vaultKey: 'EMPTY', value: '' }
  ]), [
    { key: 'TOKEN', vaultKey: 'GITHUB_TOKEN', isSecret: true },
    { key: 'LOG_LEVEL', value: 'debug', isSecret: false }
  ]);
});

test('envDraftsFromServer shows custom values but keeps secrets write-only', () => {
  const server = sampleServer({ id: 'server-1', envKey: 'GITHUB_TOKEN' });
  server.env.push({ serverId: 'server-1', key: 'LOG_LEVEL', value: 'debug', isSecret: false, secretRef: null, vaultKey: null });
  assert.deepEqual(envDraftsFromServer(server).map(({ key, mode, vaultKey, value }) => ({ key, mode, vaultKey, value })), [
    { key: 'GITHUB_TOKEN', mode: 'vault', vaultKey: 'GITHUB_TOKEN', value: '' }, // secret: not shown
    { key: 'LOG_LEVEL', mode: 'plain', vaultKey: '', value: 'debug' }           // custom: shown
  ]);
});

test('buildEditForm omits undefined optional values', () => {
  const server: McpServerWithEnv = {
    id: 'server-1',
    name: 'Server One',
    transport: 'stdio',
    command: null,
    args: [],
    cwd: null,
    url: null,
    enabled: true,
    localUrl: 'http://127.0.0.1:1987/mcp/server-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    usage: { requestCount: 0, toolCallCount: 0, estimatedTokenCount: 0, errorCount: 0, lastCalledAt: null },
    env: [{ serverId: 'server-1', key: 'TOKEN', value: null, isSecret: true, secretRef: 'ref', vaultKey: 'GITHUB_TOKEN' }]
  };

  assert.deepEqual(buildEditForm(server), {
    id: 'server-1',
    name: 'Server One',
    transport: 'stdio',
    args: [],
    enabled: true,
    env: [{ key: 'TOKEN', isSecret: true, vaultKey: 'GITHUB_TOKEN' }]
  });
});

test('withOptionalField deletes empty optional values', () => {
  assert.deepEqual(withOptionalField({ name: 'x', transport: 'stdio', enabled: true, command: 'node' }, 'command', ''), { name: 'x', transport: 'stdio', enabled: true });
});

test('filterServers matches name id env transport and command text', () => {
  const servers = [sampleServer({ id: 'github-tools', name: 'GitHub Tools', command: 'npx', envKey: 'GITHUB_TOKEN' }), sampleServer({ id: 'docs-http', name: 'Docs HTTP', transport: 'http', url: 'http://127.0.0.1:3333/mcp', envKey: 'DOCS_KEY' })];
  assert.deepEqual(filterServers(servers, 'github').map((server) => server.id), ['github-tools']);
  assert.deepEqual(filterServers(servers, 'docs_key').map((server) => server.id), ['docs-http']);
  assert.deepEqual(filterServers(servers, 'http').map((server) => server.id), ['docs-http']);
  assert.deepEqual(filterServers(servers, '').map((server) => server.id), ['github-tools', 'docs-http']);
});

test('buildDashboardMetrics rolls up server and usage counters', () => {
  const metrics = buildDashboardMetrics([
    sampleServer({ id: 'active', enabled: true, requests: 5, toolCalls: 3, tokens: 1200, errors: 1 }),
    sampleServer({ id: 'disabled', enabled: false, requests: 2, toolCalls: 1, tokens: 100, errors: 0 })
  ], [{ key: 'GITHUB_TOKEN', secretRef: 'ref-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }, { key: 'OPENAI_API_KEY', secretRef: 'ref-2', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  assert.deepEqual(metrics, { totalServers: 2, enabledServers: 1, vaultSecrets: 2, mappedSecrets: 2, requests: 7, toolCalls: 4, estimatedTokens: 1300, errors: 1 });
});

function sampleServer(overrides: { id: string; name?: string; transport?: 'stdio' | 'http'; command?: string; url?: string; envKey?: string; enabled?: boolean; requests?: number; toolCalls?: number; tokens?: number; errors?: number }): McpServerWithEnv {
  const transport = overrides.transport ?? 'stdio';
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    transport,
    command: transport === 'stdio' ? overrides.command ?? 'node' : null,
    args: transport === 'stdio' ? ['server.mjs'] : [],
    cwd: null,
    url: transport === 'http' ? overrides.url ?? 'http://127.0.0.1:3000/mcp' : null,
    enabled: overrides.enabled ?? true,
    localUrl: `http://127.0.0.1:1987/mcp/${overrides.id}`,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    usage: { requestCount: overrides.requests ?? 0, toolCallCount: overrides.toolCalls ?? 0, estimatedTokenCount: overrides.tokens ?? 0, errorCount: overrides.errors ?? 0, lastCalledAt: null },
    env: [{ serverId: overrides.id, key: overrides.envKey ?? 'TOKEN', value: null, isSecret: true, secretRef: 'ref', vaultKey: overrides.envKey ?? 'TOKEN' }]
  };
}
