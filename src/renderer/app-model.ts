import type { McpEnvVarInput, McpServerInput, McpServerWithEnv, VaultSecretRecord } from '../shared/types.js';

export interface DashboardMetrics {
  totalServers: number;
  enabledServers: number;
  vaultSecrets: number;
  mappedSecrets: number;
  requests: number;
  toolCalls: number;
  estimatedTokens: number;
  errors: number;
}

export interface EnvParamDraft {
  id: string;
  key: string;
  mode: 'vault' | 'plain';
  vaultKey: string;
  value: string;
}

export function createEnvParamDraft(index = 0, mode: EnvParamDraft['mode'] = 'vault'): EnvParamDraft {
  return { id: `env-${Date.now()}-${index}`, key: '', mode, vaultKey: '', value: '' };
}

export function envDraftsFromServer(server: McpServerWithEnv): EnvParamDraft[] {
  return server.env.map((env, index) => ({
    id: `${server.id}-${env.key}-${index}`,
    key: env.key,
    mode: env.vaultKey ? 'vault' : 'plain',
    vaultKey: env.vaultKey ?? '',
    // Secret values are null (write-only); non-secret custom values are shown.
    value: env.value ?? ''
  }));
}

export function envDraftsToInput(rows: EnvParamDraft[]): McpEnvVarInput[] {
  return rows.flatMap<McpEnvVarInput>((row) => {
    const key = row.key.trim();
    if (!key) return [];
    if (row.mode === 'vault') {
      const vaultKey = row.vaultKey.trim();
      return vaultKey ? [{ key, vaultKey, isSecret: true }] : [];
    }
    return [{ key, value: row.value, isSecret: false }];
  });
}

export function buildEditForm(server: McpServerWithEnv): McpServerInput {
  const nextForm: McpServerInput = {
    id: server.id,
    name: server.name,
    transport: server.transport,
    args: server.args,
    enabled: server.enabled,
    env: envDraftsToInput(envDraftsFromServer(server))
  };
  if (server.command) nextForm.command = server.command;
  if (server.url) nextForm.url = server.url;
  if (server.cwd) nextForm.cwd = server.cwd;
  return nextForm;
}

export function withOptionalField<K extends 'cwd' | 'command' | 'url'>(form: McpServerInput, key: K, value: string): McpServerInput {
  const next = { ...form };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

export function splitArgs(value: string): string[] {
  return value.trim() ? value.trim().split(/\s+/) : [];
}

export function filterServers(servers: McpServerWithEnv[], query: string): McpServerWithEnv[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return servers;
  return servers.filter((server) => [
    server.id,
    server.name,
    server.transport,
    server.command ?? '',
    server.url ?? '',
    server.cwd ?? '',
    ...server.args,
    ...server.env.map((env) => env.key)
  ].some((value) => value.toLowerCase().includes(needle)));
}

export function buildDashboardMetrics(servers: McpServerWithEnv[], secrets: VaultSecretRecord[] = []): DashboardMetrics {
  return servers.reduce<DashboardMetrics>((metrics, server) => ({
    totalServers: metrics.totalServers + 1,
    enabledServers: metrics.enabledServers + (server.enabled ? 1 : 0),
    vaultSecrets: metrics.vaultSecrets,
    mappedSecrets: metrics.mappedSecrets + server.env.filter((env) => env.vaultKey).length,
    requests: metrics.requests + server.usage.requestCount,
    toolCalls: metrics.toolCalls + server.usage.toolCallCount,
    estimatedTokens: metrics.estimatedTokens + server.usage.estimatedTokenCount,
    errors: metrics.errors + server.usage.errorCount
  }), { totalServers: 0, enabledServers: 0, vaultSecrets: secrets.length, mappedSecrets: 0, requests: 0, toolCalls: 0, estimatedTokens: 0, errors: 0 });
}
