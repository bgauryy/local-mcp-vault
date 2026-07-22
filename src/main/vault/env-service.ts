import type { ConfigRepository } from '../storage/config-repository.js';
import type { VaultProvider } from './vault-provider.js';
import type { McpEnvVarInput, McpServerInput, McpServerWithEnv, VaultSecretInput, VaultSecretRecord } from '../../shared/types.js';
import { parseVaultSecretInput } from '../../shared/validation.js';

export class McpConfigService {
  constructor(private readonly repository: ConfigRepository, private readonly vault: VaultProvider, private readonly gatewayBaseUrl: string) {}

  async saveServer(input: McpServerInput): Promise<McpServerWithEnv> {
    const id = input.id ?? undefined;
    const draft = { ...input, env: [...(input.env ?? [])] };
    const serverId = id ?? this.repository.upsertServer({ ...draft, env: [] }).id;
    if (!id) this.repository.deleteServer(serverId);

    const env: McpEnvVarInput[] = [];
    for (const item of draft.env ?? []) {
      if (item.isSecret) {
        if (item.vaultKey) {
          const secret = this.repository.getVaultSecret(item.vaultKey);
          if (!secret) throw new Error(`Vault key not found: ${item.vaultKey}`);
          env.push({ key: item.key, isSecret: true, vaultKey: item.vaultKey, secretRef: secret.secretRef });
        } else {
          const ref = item.secretRef ?? this.repository.createSecretRef(serverId, item.key);
          if (item.value !== undefined) await this.vault.seal(ref, item.value);
          env.push({ key: item.key, isSecret: true, secretRef: ref });
        }
      } else {
        env.push(item);
      }
    }
    return this.repository.upsertServer({ ...draft, id: serverId, env });
  }

  listServers(): McpServerWithEnv[] {
    return this.repository.listServers(this.gatewayBaseUrl);
  }

  listVaultSecrets(): VaultSecretRecord[] {
    return this.repository.listVaultSecrets();
  }

  async saveVaultSecret(input: VaultSecretInput): Promise<VaultSecretRecord> {
    const parsed = parseVaultSecretInput(input);
    const existing = this.repository.getVaultSecret(parsed.key);
    const ref = existing?.secretRef ?? this.repository.createVaultSecretRef(parsed.key);
    await this.vault.seal(ref, parsed.value);
    return this.repository.putVaultSecret(parsed.key, ref);
  }

  async deleteVaultSecret(key: string): Promise<void> {
    const ref = this.repository.deleteVaultSecret(key);
    if (ref) await this.vault.delete(ref);
  }

  getServer(id: string): McpServerWithEnv | null {
    return this.repository.getServer(id, this.gatewayBaseUrl);
  }

  async setServerEnabled(id: string, enabled: boolean): Promise<McpServerWithEnv> {
    const server = this.getServer(id);
    if (!server) throw new Error(`MCP server not found: ${id}`);
    const input: McpServerInput = {
      id: server.id,
      name: server.name,
      transport: server.transport,
      args: server.args,
      enabled,
      env: server.env.map((env) => env.vaultKey ? { key: env.key, isSecret: true, vaultKey: env.vaultKey } : env.secretRef ? { key: env.key, isSecret: env.isSecret, secretRef: env.secretRef } : { key: env.key, isSecret: env.isSecret, value: env.value ?? '' })
    };
    if (server.command) input.command = server.command;
    if (server.url) input.url = server.url;
    if (server.cwd) input.cwd = server.cwd;
    return this.saveServer(input);
  }

  recordUsage(serverId: string, method: string | undefined, estimatedTokens: number, ok: boolean): void {
    const event = method === undefined ? { estimatedTokens, ok } : { method, estimatedTokens, ok };
    this.repository.recordUsage(serverId, event);
  }

  async deleteServer(id: string): Promise<void> {
    for (const ref of this.repository.deleteServer(id)) await this.vault.delete(ref);
  }

  async resolveEnv(server: McpServerWithEnv): Promise<Record<string, string>> {
    const env: Record<string, string> = {};
    for (const item of server.env) {
      if (item.isSecret) {
        const ref = item.vaultKey ? this.repository.getVaultSecret(item.vaultKey)?.secretRef : item.secretRef;
        if (!ref) throw new Error(`Secret env ${item.key} is missing a vault reference`);
        env[item.key] = await this.vault.reveal(ref);
      } else if (item.value !== null) {
        env[item.key] = item.value;
      }
    }
    return env;
  }
}
