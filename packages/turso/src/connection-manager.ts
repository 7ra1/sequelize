import type { AbstractConnection, ConnectionOptions } from '@sequelize/core';
import { AbstractConnectionManager, ConnectionError } from '@sequelize/core';
import { logger } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/logger.js';
import { checkFileExists } from '@sequelize/utils/node';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as TursoDatabase from '@tursodatabase/database';
import type { TursoDialect } from './dialect.js';

const debug = logger.debugContext('connection:turso');

export type TursoModule = typeof TursoDatabase;

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
  storage?: string;

  mode?: number;

  password?: string;

  url?: string;

  authToken?: string;
}

export class TursoConnectionManager extends AbstractConnectionManager<
  TursoDialect,
  TursoConnection
> {
  readonly #lib: TursoModule;

  constructor(dialect: TursoDialect) {
    super(dialect);

    this.#lib = this.dialect.options.tursoModule ?? TursoDatabase;
  }

  async connect(options: ConnectionOptions<TursoDialect>): Promise<TursoConnection> {
    const isRemote = Boolean(options.url);
    
    if (isRemote) {
      if (!options.authToken) {
        throw new Error('authToken is required when using remote Turso database (url option)');
      }

      try {
        const db = await this.#lib.connect(options.url!, {
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
      console.log(`[TURSO DEBUG] Connecting to storage: ${storage}`);
      const connection = await this.#lib.connect(storage);

      console.log(`[TURSO DEBUG] turso connection acquired`);

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
