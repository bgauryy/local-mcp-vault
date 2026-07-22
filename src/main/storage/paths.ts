import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoragePaths {
  rootDir: string;
  databasePath: string;
  logsDir: string;
}

export function resolveStoragePaths(rootDir = process.env.OCTOVAULT_HOME ?? join(homedir(), '.octovault')): StoragePaths {
  return {
    rootDir,
    databasePath: join(rootDir, 'vault.db'),
    logsDir: join(rootDir, 'logs')
  };
}
