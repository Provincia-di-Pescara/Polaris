import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// frontend-backoffice/src/testUtil/ -> ../../../backend-node (radice del monorepo, poi dentro backend-node)
const BACKEND_DIR = path.resolve(__dirname, '../../../backend-node');

export interface BackendReale {
  baseUrl: string;
  chiudi: () => Promise<void>;
}

export async function avviaBackendReale(): Promise<BackendReale> {
  const dsn = process.env.TEST_DATABASE_URL;
  if (!dsn) {
    throw new Error('TEST_DATABASE_URL non impostata');
  }
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const baseUrl = `http://127.0.0.1:${porta}`;

  const child: ChildProcess = spawn('node', ['src/index.ts'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: dsn,
      PORT: String(porta),
      JWT_SECRET: process.env.JWT_SECRET ?? 'segreto-di-test-non-usare-in-produzione',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('backend reale non avviato entro 15s'));
    }, 15000);

    child.once('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    const provaConnessione = async (): Promise<void> => {
      try {
        const r = await fetch(`${baseUrl}/healthz`);
        if (r.ok) {
          clearTimeout(timeoutId);
          resolve();
          return;
        }
      } catch {
        // backend non ancora in ascolto, riprova
      }
      setTimeout(() => {
        provaConnessione();
      }, 200);
    };
    provaConnessione();
  });

  return {
    baseUrl,
    chiudi: () =>
      new Promise<void>((resolve) => {
        const forzaChiusura = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000);
        child.once('exit', () => {
          clearTimeout(forzaChiusura);
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
}
