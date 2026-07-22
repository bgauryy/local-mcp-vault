export type McpTransportKind = 'stdio' | 'http';

export type VaultBackendStatus = 'safe' | 'degraded' | 'blocked';

export interface McpEnvVarInput {
  key: string;
  value?: string;
  secretRef?: string;
  vaultKey?: string;
  isSecret: boolean;
}

export interface VaultSecretInput {
  key: string;
  value: string;
}

export interface McpServerInput {
  id?: string;
  name: string;
  transport: McpTransportKind;
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  enabled: boolean;
  env?: McpEnvVarInput[];
}

export interface McpServerRecord {
  id: string;
  name: string;
  transport: McpTransportKind;
  command: string | null;
  args: string[];
  url: string | null;
  cwd: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpEnvVarRecord {
  serverId: string;
  key: string;
  isSecret: boolean;
  value: string | null;
  secretRef: string | null;
  vaultKey: string | null;
}

export interface VaultSecretRecord {
  key: string;
  secretRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpUsageMetrics {
  requestCount: number;
  toolCallCount: number;
  estimatedTokenCount: number;
  errorCount: number;
  lastCalledAt: string | null;
}

export interface McpServerWithEnv extends McpServerRecord {
  env: McpEnvVarRecord[];
  localUrl: string;
  usage: McpUsageMetrics;
}

export interface VaultEntryRecord {
  ref: string;
  backend: string;
  ciphertext: Uint8Array;
  createdAt: string;
  updatedAt: string;
}

export interface VaultStatus {
  backend: string;
  status: VaultBackendStatus;
  canPersistSecrets: boolean;
  message: string;
}

export interface GatewayConfig {
  host: '127.0.0.1';
  port: number;
  accessKey: string;
}

export interface ServerHealth {
  serverId: string;
  ok: boolean;
  status: 'disabled' | 'ready' | 'error';
  message: string;
}

export interface ClientConfigSnippet {
  mcpServers: Record<string, {
    transport: 'streamableHttp';
    url: string;
    headers: Record<string, string>;
  }>;
}
