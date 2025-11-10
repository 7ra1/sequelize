'use strict';

import {
  AbstractQuery,
  DatabaseError,
  EmptyResultError,
  ForeignKeyConstraintError,
  TimeoutError,
  UniqueConstraintError,
  ValidationErrorItem,
} from '@sequelize/core';
import { logger } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/logger.js';
import isEqual from 'lodash/isEqual';
import isPlainObject from 'lodash/isPlainObject';
import merge from 'lodash/merge';

const debug = logger.debugContext('sql:turso');

// sqlite3 currently ignores bigint values, so we have to translate to string for now
// There's a WIP here: https://github.com/TryGhost/node-sqlite3/pull/1501
function stringifyIfBigint(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  return value;
}

export class TursoQuery extends AbstractQuery {
  getInsertIdField() {
    return 'lastID';
  }

  _collectModels(include, prefix) {
    const ret = {};

    if (include) {
      for (const _include of include) {
        let key;
        if (!prefix) {
          key = _include.as;
        } else {
          key = `${prefix}.${_include.as}`;
        }

        ret[key] = _include.model;

        if (_include.include) {
          merge(ret, this._collectModels(_include.include, key));
        }
      }
    }

    return ret;
  }

  _handleQueryResponse(metaData, results) {
    if (this.isInsertQuery() || this.isUpdateQuery() || this.isUpsertQuery()) {
      if (this.instance && this.instance.dataValues) {
        // If we are creating an instance, and we get no rows, the create failed but did not throw.
        // This probably means a conflict happened and was ignored, to avoid breaking a transaction.
        if (this.isInsertQuery() && !this.isUpsertQuery() && results.length === 0) {
          throw new EmptyResultError();
        }

        if (Array.isArray(results) && results[0]) {
          for (const attributeOrColumnName of Object.keys(results[0])) {
            const modelDefinition = this.model.modelDefinition;
            const attribute = modelDefinition.columns.get(attributeOrColumnName);
            const updatedValue = this._parseDatabaseValue(
              results[0][attributeOrColumnName],
              attribute?.type,
            );

            this.instance.set(attribute?.attributeName ?? attributeOrColumnName, updatedValue, {
              raw: true,
              comesFromDatabase: true,
            });
          }
        }
      }

      if (this.isUpsertQuery()) {
        return [this.instance, null];
      }

      return [
        this.instance || (results && ((this.options.plain && results[0]) || results)) || undefined,
        this.options.returning ? results.length : metaData.changes,
      ];
    }

    if (this.isBulkUpdateQuery()) {
      return this.options.returning ? this.handleSelectQuery(results) : metaData.changes;
    }

    if (this.isDeleteQuery()) {
      return metaData.changes;
    }

    if (this.isShowConstraintsQuery()) {
      return results;
    }

    if (this.isSelectQuery()) {
      return this.handleSelectQuery(results);
    }

    if (this.isShowOrDescribeQuery()) {
      return results;
    }

    if (this.sql.includes('PRAGMA INDEX_LIST')) {
      return this.handleShowIndexesQuery(results);
    }

    if (this.sql.includes('PRAGMA INDEX_INFO')) {
      return results;
    }

    if (this.sql.includes('PRAGMA TABLE_INFO')) {
      // this is the sqlite way of getting the metadata of a table
      const result = {};

      let defaultValue;
      for (const _result of results) {
        if (_result.dflt_value === null) {
          // Column schema omits any "DEFAULT ..."
          defaultValue = undefined;
        } else if (_result.dflt_value === 'NULL') {
          // Column schema is a "DEFAULT NULL"
          defaultValue = null;
        } else {
          defaultValue = _result.dflt_value;
        }

        result[_result.name] = {
          type: _result.type,
          allowNull: _result.notnull === 0,
          defaultValue,
          primaryKey: _result.pk !== 0,
        };

        if (result[_result.name].type === 'TINYINT(1)') {
          result[_result.name].defaultValue = { 0: false, 1: true }[
            result[_result.name].defaultValue
          ];
        }

        if (typeof result[_result.name].defaultValue === 'string') {
          result[_result.name].defaultValue = result[_result.name].defaultValue.replaceAll("'", '');
        }
      }

      return result;
    }

    if (this.isRawQuery()) {
      return [results, metaData];
    }

    return this.instance;
  }

  async run(sql, parameters) {
    const conn = this.connection;
    this.sql = sql;
    const method = this.getDatabaseMethod();
    const complete = this._logQuery(sql, debug, parameters);

    const executeSql = async () => {
      if (!parameters) {
        parameters = [];
      }

      console.log('DEBUG_PARAMETERS_BEFORE', parameters);
      if (isPlainObject(parameters)) {
        const newParameters = Object.create(null);

        for (const key of Object.keys(parameters)) {
          const normalizedKey = key.startsWith('$') ? key : `$${key}`;
          newParameters[normalizedKey] = stringifyIfBigint(parameters[key]);
        }

        parameters = newParameters;
        console.log('DEBUG_PARAMETERS_AFTER', parameters);
      } else {
        parameters = parameters.map(stringifyIfBigint);
      }

      let response;
      try {
        if (method === 'run') {
          response = await this.#runSeries(conn, sql, parameters);
        } else {
          response = await this.#allSeries(conn, sql, parameters);
        }
      } catch (error) {
        error.sql = this.sql;
        throw this.formatError(error);
      }

      complete();

      return this._handleQueryResponse(response.statement, response.results);
    };

    return executeSql();
  }

  async #allSeries(connection, query, parameters) {
    debug(`Preparing query: ${query}`);
    const stmt = connection.prepare(query);

    try {
      let results;
      if (Array.isArray(parameters)) {
        results = await stmt.all(...parameters);
      } else if (parameters && typeof parameters === 'object') {
        const paramArray = this._convertNamedParamsToPositional(query, parameters);
        results = await stmt.all(...paramArray);
      } else {
        results = await stmt.all();
      }

      return {
        statement: {
          lastID: 0,
          changes: 0,
        },
        results,
      };
    } finally {
      stmt.close();
    }
  }

  async #runSeries(connection, query, parameters) {
    const stmt = connection.prepare(query);

    try {
      let result;
      if (Array.isArray(parameters)) {
        result = await stmt.run(...parameters);
      } else if (parameters && typeof parameters === 'object') {
        const paramArray = this._convertNamedParamsToPositional(query, parameters);
        result = await stmt.run(...paramArray);
      } else {
        result = await stmt.run();
      }

      return {
        statement: {
          lastID: Number(result.lastInsertRowid),
          changes: result.changes,
        },
        results: [],
      };
    } finally {
      stmt.close();
    }
  }

  _convertNamedParamsToPositional(query, namedParams) {
    const paramNames = [];
    const paramRegex = /\$(\w+)/g;
    let match;
    while ((match = paramRegex.exec(query)) !== null) {
      paramNames.push(match[1]);
    }

    const keys = Object.keys(namedParams);
    const usedKeys = new Set();

    return paramNames.map(name => {
      const prefixed = `$${name}`;
      if (Object.hasOwn(namedParams, prefixed)) {
        usedKeys.add(prefixed);
        return namedParams[prefixed];
      }

      if (Object.hasOwn(namedParams, name)) {
        usedKeys.add(name);
        return namedParams[name];
      }

      const fallbackKey = keys.find(key => !usedKeys.has(key));
      if (fallbackKey !== undefined) {
        usedKeys.add(fallbackKey);
        return namedParams[fallbackKey];
      }

      return null;
    });
  }

  formatError(err) {
    switch (err.code) {
      case 'SQLITE_CONSTRAINT_UNIQUE':
      case 'SQLITE_CONSTRAINT_PRIMARYKEY':
      case 'SQLITE_CONSTRAINT_TRIGGER':
      case 'SQLITE_CONSTRAINT_FOREIGNKEY':
      case 'SQLITE_CONSTRAINT': {
        if (err.message.includes('FOREIGN KEY constraint failed')) {
          return new ForeignKeyConstraintError({
            cause: err,
          });
        }

        let fields = [];

        // Sqlite pre 2.2 behavior - Error: SQLITE_CONSTRAINT: columns x, y are not unique
        let match = err.message.match(/columns (.*?) are/);
        if (match !== null && match.length >= 2) {
          fields = match[1].split(', ');
        } else {
          // Sqlite post 2.2 behavior - Error: SQLITE_CONSTRAINT: UNIQUE constraint failed: table.x, table.y
          match = err.message.match(/UNIQUE constraint failed: (.*)/);
          if (match !== null && match.length >= 2) {
            fields = match[1].split(', ').map(columnWithTable => columnWithTable.split('.')[1]);
          }
        }

        const errors = [];
        let message = 'Validation error';

        for (const field of fields) {
          errors.push(
            new ValidationErrorItem(
              this.getUniqueConstraintErrorMessage(field),
              'unique violation', // ValidationErrorItem.Origins.DB,
              field,
              this.instance && this.instance[field],
              this.instance,
              'not_unique',
            ),
          );
        }

        if (this.model) {
          for (const index of this.model.getIndexes()) {
            if (index.unique && isEqual(index.fields, fields) && index.msg) {
              message = index.msg;
              break;
            }
          }
        }

        return new UniqueConstraintError({ message, errors, cause: err, fields });
      }

      case 'SQLITE_BUSY':
        return new TimeoutError(err);

      default:
        return new DatabaseError(err);
    }
  }

  async handleShowIndexesQuery(data) {
    // Sqlite returns indexes so the one that was defined last is returned first. Lets reverse that!
    return Promise.all(
      data.reverse().map(async item => {
        item.fields = [];
        item.primary = false;
        item.unique = Boolean(item.unique);
        item.constraintName = item.name;
        const columns = await this.run(`PRAGMA INDEX_INFO(\`${item.name}\`)`);
        for (const column of columns) {
          item.fields[column.seqno] = {
            attribute: column.name,
            length: undefined,
            order: undefined,
          };
        }

        return item;
      }),
    );
  }

  getDatabaseMethod() {
    if (
      this.isBulkUpdateQuery() ||
      this.isInsertQuery() ||
      this.isUpdateQuery() ||
      this.isUpsertQuery()
    ) {
      return this.options.returning ? 'all' : 'run';
    }

    if (
      this.isDeleteQuery() ||
      this.sql.toLowerCase().includes('CREATE TEMPORARY TABLE'.toLowerCase())
    ) {
      return 'run';
    }

    return 'all';
  }
}
