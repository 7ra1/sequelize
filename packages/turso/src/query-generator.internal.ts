import { AbstractQueryGeneratorInternal } from '@sequelize/core/_non-semver-use-at-your-own-risk_/abstract-dialect/query-generator-internal.js';
import type { AddLimitOffsetOptions } from '@sequelize/core/_non-semver-use-at-your-own-risk_/abstract-dialect/query-generator.internal-types.js';
import type { TursoDialect } from './dialect.js';

export class TursoQueryGeneratorInternal<
  Dialect extends TursoDialect = TursoDialect,
> extends AbstractQueryGeneratorInternal<Dialect> {
  addLimitAndOffset(options: AddLimitOffsetOptions) {
    let fragment = '';
    if (options.limit != null) {
      fragment += ` LIMIT ${this.queryGenerator.escape(options.limit, options)}`;
    } else if (options.offset) {
      // limit must be specified if offset is specified.
      fragment += ` LIMIT -1`;
    }

    if (options.offset) {
      fragment += ` OFFSET ${this.queryGenerator.escape(options.offset, options)}`;
    }

    return fragment;
  }
}
