import { Pool } from 'pg';

export function creaPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}
