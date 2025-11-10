import { AbstractQuery } from '@sequelize/core';

export class TursoQuery extends AbstractQuery {
  protected _convertNamedParamsToPositional(
    query: string,
    namedParams: Record<string, unknown>,
  ): unknown[];
}
