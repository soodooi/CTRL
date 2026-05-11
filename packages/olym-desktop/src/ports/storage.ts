// Storage Port — desktop storage abstraction (SQLite + secure-store + R2-mock).
// Concrete adapters wrap Tauri SQL plugin, Tauri Keychain, local FS.

export interface KVPort {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface SQLitePort {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface SecureStorePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface StoragePort {
  readonly sqlite: SQLitePort;
  readonly kv: KVPort;
  readonly secure: SecureStorePort;
}
