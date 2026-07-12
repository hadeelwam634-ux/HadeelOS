/**
 * The minimal subset of `pg.Pool` (and `pg.PoolClient`) that the Postgres
 * repository adapters actually need. Depending on this narrow interface
 * instead of importing `Pool` directly means:
 *
 *   - tests can pass a pg-mem-backed fake without pulling in a real
 *     Postgres server (see tests/persistence/postgres/contract.test.ts)
 *   - any future connection-pooling/proxy layer only needs to implement
 *     one method to be a valid backend
 */
export interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }>;
}
