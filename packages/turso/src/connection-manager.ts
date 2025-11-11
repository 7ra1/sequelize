import type { AbstractConnection, ConnectionOptions } from '@sequelize/core';
import { AbstractConnectionManager, ConnectionError } from '@sequelize/core';
import { logger } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/logger.js';
import { checkFileExists } from '@sequelize/utils/node';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TursoDialect } from './dialect.js';

const debug = logger.debugContext('connection:turso');

export type TursoModule = typeof import('@tursodatabase/database');

let cachedDefaultModule: TursoModule | undefined;
let defaultModulePromise: Promise<TursoModule> | undefined;

async function loadDefaultTursoModule(): Promise<TursoModule> {
  if (cachedDefaultModule) {
    return cachedDefaultModule;
  }

  if (!defaultModulePromise) {
    defaultModulePromise = import('@tursodatabase/database')
      .then(module => {
        cachedDefaultModule = module;
        return module;
      })
      .catch(error => {
        defaultModulePromise = undefined;
        throw error;
      });
  }

  return defaultModulePromise;
}

const CLOSED_SYMBOL = Symbol('closed');

export interface TursoConnection extends AbstractConnection {
  exec(sql: string): Promise<void>;
  prepare(sql: string): TursoStatement;
  close(): Promise<void>;
  filename?: string;
  [CLOSED_SYMBOL]?: boolean;
}

export interface TursoStatement {
  run(...params: any[]): Promise<{ changes: number; lastInsertRowid: number }>;
  all(...params: any[]): Promise<any[]>;
  get(...params: any[]): Promise<any>;
  columns(): any[];
  close(): void;
}

export interface TursoConnectionOptions {
  /**
   * Path to the local database file.
   * Use ':memory:' for in-memory database.
   * For embedded replicas, this is the local replica file path.
   */
  storage?: string;

  /**
   * SQLite open mode flags (not commonly used with Turso)
   */
  mode?: number;

  /**
   * Password for encrypted local databases (uses PRAGMA KEY)
   */
  password?: string;

  /**
   * Remote Turso database URL (libsql://...).
   * When provided, connects to a remote Turso database.
   * Requires authToken.
   */
  url?: string;

  /**
   * Authentication token for remote Turso database.
   * Required when using url option.
   * Get this from your Turso dashboard.
   */
  authToken?: string;

  /**
   * Remote database URL for embedded replicas.
   * When provided with storage, creates an embedded replica that syncs with remote.
   * Note: Requires @libsql/client package for full embedded replica support.
   */
  syncUrl?: string;

  /**
   * Automatic sync interval in seconds for embedded replicas.
   * When set, the local replica will automatically sync with remote at this interval.
   * Note: Requires @libsql/client package for embedded replica support.
   */
  syncInterval?: number;

  /**
   * Encryption key for database encryption at rest.
   * Provides additional security for local database files.
   * Note: Requires @libsql/client package for encryption support.
   */
  encryptionKey?: string;

  /**
   * Open database in readonly mode.
   * Prevents any write operations to the database.
   */
  readonly?: boolean;

  /**
   * Enable Write-Ahead Logging (WAL) mode for better concurrency.
   * Default: true (enabled by default for local databases)
   * WAL mode allows concurrent readers while a write is in progress.
   */
  enableWal?: boolean;
}

export class TursoConnectionManager extends AbstractConnectionManager<
  TursoDialect,
  TursoConnection
> {
  #lib: TursoModule | undefined;
  #libPromise: Promise<TursoModule> | undefined;

  constructor(dialect: TursoDialect) {
    super(dialect);

    if (this.dialect.options.tursoModule) {
      this.#lib = this.dialect.options.tursoModule;
    }
  }

  async #getLib(): Promise<TursoModule> {
    if (this.#lib) {
      return this.#lib;
    }

    if (!this.#libPromise) {
      this.#libPromise = loadDefaultTursoModule()
        .then(module => {
          this.#lib = module;
          return module;
        })
        .catch(error => {
          this.#libPromise = undefined;
          throw error;
        });
    }

    return this.#libPromise;
  }

  async connect(options: ConnectionOptions<TursoDialect>): Promise<TursoConnection> {
    let lib: TursoModule;

    try {
      lib = await this.#getLib();
    } catch (error) {
      const err = error as NodeJS.ErrnoException;

      if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
        throw new Error('Unable to load @tursodatabase/database. Install the package to use the Turso dialect.');
      }

      throw error;
    }

    const isRemote = Boolean(options.url);
    
    if (isRemote) {
      if (!options.authToken) {
        throw new Error('authToken is required when using remote Turso database (url option)');
      }

      try {
        const db = await lib.connect(options.url!, {
          authToken: options.authToken,
        } as any);

        debug(`turso remote connection acquired to ${options.url}`);

        return db as unknown as TursoConnection;
      } catch (err) {
        throw new ConnectionError(err as Error);
      }
    }

    const storage = options.storage ?? path.join(process.cwd(), 'sequelize.turso');
    const inMemory = storage === ':memory:';

    const isTemporaryStorage = inMemory || storage === '';
    if (isTemporaryStorage) {
      const pool = this.sequelize.pool;
      const writePool = pool.write as any;

      if (writePool.idleTimeoutMillis !== Infinity) {
        throw new Error(`Turso is configured to use a temporary database, but the pool is configured to close idle connections, which would lead to data loss while the application is running.
To fix this, set the pool's idleTimeoutMillis to Infinity, or use a non-temporary database.`);
      }

      if (writePool.maxUsesPerResource !== Infinity) {
        throw new Error(`Turso is configured to use a temporary database, but the pool is configured to close connections after ${writePool.maxUsesPerResource}, which would lead to data loss while the application is running.
To fix this, set the pool's maxUsesPerResource to Infinity, or use a non-temporary database.`);
      }

      if (writePool.maxSize !== 1) {
        throw new Error(`Turso is configured to use a temporary database, but the pool is configured to allow more than one connection, which would create separate temporary databases.
To fix this, set the pool's maxSize to 1, or use a non-temporary database.`);
      }

      if (pool.read) {
        throw new Error(`Turso is configured to use a temporary database, but read-replication is enabled, which would read a different temporary database.
To fix this, disable read replication, or use a non-temporary database.`);
      }
    }

    const storageDir = path.dirname(storage);

    if (!isTemporaryStorage && !(await checkFileExists(storageDir))) {
      await fs.mkdir(storageDir, { recursive: true });
    }

    try {
      debug(`Connecting to storage: ${storage}`);
      const connection = await lib.connect(storage);

      debug(`turso connection acquired`);

      const tursoConnection = connection as unknown as TursoConnection;
      tursoConnection.filename = storage;

      if (options.password) {
        debug(`Executing PRAGMA KEY`);
        try {
          await tursoConnection.exec(`PRAGMA KEY=${this.sequelize.escape(options.password)}`);
          debug(`PRAGMA KEY executed successfully`);
        } catch (err) {
          debug(`PRAGMA KEY failed: ${(err as Error).message}`);
          throw err;
        }
      }

      if (this.dialect.options.foreignKeys !== false) {
        debug(`Executing PRAGMA foreign_keys = ON`);
        try {
          await tursoConnection.exec('PRAGMA foreign_keys = ON');
          debug(`PRAGMA foreign_keys = ON executed successfully`);
        } catch (err) {
          debug(`PRAGMA foreign_keys = ON failed: ${(err as Error).message}`);
          throw err;
        }
      }

      if (options.enableWal !== false && !isRemote) {
        debug(`Enabling WAL mode for better concurrency`);
        try {
          await tursoConnection.exec('PRAGMA journal_mode = WAL');
          debug(`WAL mode enabled successfully`);
        } catch (err) {
          debug(`WAL mode enable failed: ${(err as Error).message}`);
        }
      }

      debug(`Connection setup complete`);
      
      return tursoConnection;
    } catch (err) {
      debug(`Connection error: ${(err as Error).message}`);
      throw new ConnectionError(err as Error);
    }
  }

  validate(connection: TursoConnection): boolean {
    return !connection[CLOSED_SYMBOL];
  }

  async disconnect(connection: TursoConnection): Promise<void> {
    if (connection[CLOSED_SYMBOL]) {
      return;
    }

    try {
      await connection.close();
      debug(`turso connection released`);
      connection[CLOSED_SYMBOL] = true;
    } catch (err) {
      throw err;
    }
  }
}
