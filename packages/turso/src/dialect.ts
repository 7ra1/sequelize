import type { Sequelize } from '@sequelize/core';
import { AbstractDialect } from '@sequelize/core';
import { createNamedParamBindCollector } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/sql.js';
import { getSynchronizedTypeKeys } from '@sequelize/utils';
import * as DataTypes from './_internal/data-types-overrides.js';
import type { TursoModule, TursoConnectionOptions } from './connection-manager.js';
import { TursoConnectionManager } from './connection-manager.js';
import { TursoQueryGenerator } from './query-generator.js';
import { TursoQueryInterface } from './query-interface.js';
import { TursoQuery } from './query.js';

export interface TursoDialectOptions {
  foreignKeys?: boolean;

  tursoModule?: TursoModule;
}

const DIALECT_OPTION_NAMES = getSynchronizedTypeKeys<TursoDialectOptions>({
  foreignKeys: undefined,
  tursoModule: undefined,
});

const CONNECTION_OPTION_NAMES = getSynchronizedTypeKeys<TursoConnectionOptions>({
  storage: undefined,
  password: undefined,
  mode: undefined,
  url: undefined,
  authToken: undefined,
});

export class TursoDialect extends AbstractDialect<TursoDialectOptions, TursoConnectionOptions> {
  static supports = AbstractDialect.extendSupport({
    DEFAULT: false,
    'DEFAULT VALUES': true,
    'UNION ALL': false,
    'RIGHT JOIN': false,
    returnValues: 'returning',
    inserts: {
      ignoreDuplicates: ' OR IGNORE',
      updateOnDuplicate: ' ON CONFLICT DO UPDATE SET',
      conflictFields: true,
      onConflictWhere: true,
    },
    index: {
      using: false,
      where: true,
      functionBased: true,
    },
    startTransaction: {
      useBegin: true,
      transactionType: true,
    },
    constraints: {
      foreignKeyChecksDisableable: true,
      add: false,
      remove: false,
    },
    groupedLimit: false,
    dataTypes: {
      CHAR: false,
      COLLATE_BINARY: true,
      CITEXT: true,
      DECIMAL: false,
      BIGINT: false,
      JSON: true,
    },
    jsonOperations: false,
    jsonExtraction: {
      unquoted: false,
      quoted: false,
    },
    truncate: {
      restartIdentity: false,
    },
    delete: {
      limit: false,
    },
  });

  readonly Query = TursoQuery;
  readonly connectionManager: TursoConnectionManager;
  readonly queryGenerator: TursoQueryGenerator;
  readonly queryInterface: TursoQueryInterface;

  constructor(sequelize: Sequelize, options: TursoDialectOptions) {
    super({
      identifierDelimiter: '`',
      options,
      dataTypeOverrides: DataTypes,
      sequelize,
      minimumDatabaseVersion: '3.8.0',
      dataTypesDocumentationUrl: 'https://www.sqlite.org/datatype3.html',
      name: 'turso',
    });

    this.connectionManager = new TursoConnectionManager(this);
    this.queryGenerator = new TursoQueryGenerator(this);
    this.queryInterface = new TursoQueryInterface(this);
  }

  parseConnectionUrl(): TursoConnectionOptions {
    throw new Error(
      'The "url" option in Sequelize configuration is not supported for Turso dialect. Please use the "storage" option for local databases or "url" and "authToken" in the connection options for remote Turso databases.',
    );
  }

  createBindCollector() {
    return createNamedParamBindCollector('$');
  }

  getDefaultSchema(): string {
    return '';
  }

  static getSupportedOptions() {
    return DIALECT_OPTION_NAMES;
  }

  static getSupportedConnectionOptions(): readonly string[] {
    return CONNECTION_OPTION_NAMES;
  }
}
