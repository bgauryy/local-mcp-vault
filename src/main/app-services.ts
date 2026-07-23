import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStoragePaths } from './storage/paths.js';
import { ConfigRepository } from './storage/config-repository.js';
import { resolveDatabaseKey, type DatabaseKeyOptions } from './storage/db-key.js';
import { McpConfigService } from './vault/env-service.js';
import { KeyStore } from './vault/key-store.js';
import { INSECURE_DEFAULT_PASSWORD, PasswordVaultProvider, SafeStorageVaultProvider, type SafeStorageLike, type VaultProvider } from './vault/vault-provider.js';
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
  readonly keyStore: KeyStore;
  readonly configService: McpConfigService;
  readonly runtime: McpRuntime;
  readonly gateway: LocalGateway;
  private readonly explicitAccessKey: boolean;

  constructor(options: AppServicesOptions = {}) {
    const paths = resolveStoragePaths(options.storageRoot);
    mkdirSync(paths.rootDir, { recursive: true });
    mkdirSync(paths.logsDir, { recursive: true });
    // Whole-database encryption key (SQLCipher): sealed by the OS keychain, or
    // derived from OCTOVAULT_PASSWORD headlessly. Undefined ⇒ unencrypted (e.g. tests).
    const keyOptions: DatabaseKeyOptions = {};
    if (options.safeStorage) keyOptions.safeStorage = options.safeStorage;
    const dbPassword = options.fallbackPassword ?? process.env.OCTOVAULT_PASSWORD;
    if (dbPassword) keyOptions.password = dbPassword;
    const encryptionKey = resolveDatabaseKey(join(paths.rootDir, 'db.key'), keyOptions);
    this.repository = new ConfigRepository(paths.databasePath, encryptionKey);
    this.vault = options.safeStorage
      ? new SafeStorageVaultProvider(this.repository, options.safeStorage)
      : new PasswordVaultProvider(this.repository, options.fallbackPassword ?? process.env.OCTOVAULT_PASSWORD ?? INSECURE_DEFAULT_PASSWORD);
    this.keyStore = new KeyStore(this.repository, this.vault);
    const port = options.gatewayPort ?? Number(process.env.OCTOVAULT_PORT ?? 1987);
    this.configService = new McpConfigService(this.repository, this.vault, `http://127.0.0.1:${port}`, this.keyStore);
    this.runtime = new McpRuntime(this.configService);
    this.explicitAccessKey = options.accessKey !== undefined;
    this.gateway = this.explicitAccessKey
      ? new LocalGateway(this.configService, this.runtime, { port, accessKey: options.accessKey! })
      : new LocalGateway(this.configService, this.runtime, { port });
  }

  async start(): Promise<void> {
    // Warm the key cache (sealed at rest) before serving; seed the master key.
    await this.keyStore.init(this.configService.listServers().map((server) => server.id));
    if (!this.explicitAccessKey) this.gateway.setAccessKey(this.keyStore.master());
    await this.gateway.start();
  }

  async stop(): Promise<void> {
    await this.gateway.stop();
    this.runtime.stop();
    this.repository.close();
  }
}
