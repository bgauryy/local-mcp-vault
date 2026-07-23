// Minimal ambient types for the SQLCipher-capable, synchronous SQLite driver.
// (The package ships no bundled .d.ts; we only use the subset below.)
declare module 'better-sqlite3-multiple-ciphers' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  interface BetterSqlite3Database {
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    close(): void;
  }

  interface DatabaseConstructor {
    new (filename: string, options?: Record<string, unknown>): BetterSqlite3Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
  export type { BetterSqlite3Database };
}
