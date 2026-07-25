import { creaPool } from './db.ts';
import { creaApp } from './server.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL non impostata');
}
const porta = process.env.PORT ?? '3000';

const pool = creaPool(databaseUrl);
const app = creaApp(pool);

const server = app.listen(Number(porta), () => {
  console.log(`backend in ascolto su :${porta}`);
});

async function arresto(): Promise<void> {
  console.log('arresto in corso...');
  server.close();
  await pool.end();
}

process.on('SIGINT', arresto);
process.on('SIGTERM', arresto);
