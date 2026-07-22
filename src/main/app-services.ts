import { mkdirSync } from 'node:fs';
import { resolveStoragePaths } from './storage/paths.js';
import { ConfigRepository } from './storage/config-repository.js';
import { McpConfigService } from './vault/env-service.js';
import { PasswordVaultProvider, SafeStorageVaultProvider, type SafeStorageLike, type VaultProvider } from './vault/vault-provider.js';
import { McpRuntime } from './mcp/mcp-runtime.js';
import { LocalGateway } from './gateway/local-gateway.js';

export interface AppServicesOptions {
  storageRoot?: string;
  safeStorage?: SafeStorageLike;
  fallbackPassword?: string;
  gatewayPort?: number;
  accessKey?: string;
}

export class AppServices {
  readonly repository: ConfigRepository;
  readonly vault: VaultProvider;
  readonly configService: McpConfigService;
  readonly runtime: McpRuntime;
  readonly gateway: LocalGateway;

  constructor(options: AppServicesOptions = {}) {
    const paths = resolveStoragePaths(options.storageRoot);
    mkdirSync(paths.rootDir, { recursive: true });
    mkdirSync(paths.logsDir, { recursive: true });
    this.repository = new ConfigRepository(paths.databasePath);
    this.vault = options.safeStorage
      ? new SafeStorageVaultProvider(this.repository, options.safeStorage)
      : new PasswordVaultProvider(this.repository, options.fallbackPassword ?? process.env.OCTOVAULT_PASSWORD ?? 'development-only-change-me');
    const port = options.gatewayPort ?? Number(process.env.OCTOVAULT_PORT ?? 1987);
    this.configService = new McpConfigService(this.repository, this.vault, `http://127.0.0.1:${port}`);
    this.runtime = new McpRuntime(this.configService);
    const gatewayOptions = options.accessKey === undefined ? { port } : { port, accessKey: options.accessKey };
    this.gateway = new LocalGateway(this.configService, this.runtime, gatewayOptions);
  }

  async start(): Promise<void> {
    await this.gateway.start();
  }

  async stop(): Promise<void> {
    await this.gateway.stop();
    this.runtime.stop();
    this.repository.close();
  }
}
