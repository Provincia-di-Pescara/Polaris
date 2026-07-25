import { Pool, type QueryResult, type QueryResultRow } from 'pg';

export function creaPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

// Interfaccia minima soddisfatta sia da Pool che da PoolClient: le funzioni che devono
// poter girare dentro una transazione (ricevendo il client) la usano al posto di Pool.
export interface Db {
  query<R extends QueryResultRow = QueryResultRow>(testo: string, valori?: unknown[]): Promise<QueryResult<R>>;
}
