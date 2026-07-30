import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';

// Volume Docker named in produzione (mai bind mount, vedi CLAUDE.md), directory locale
// di sviluppo/test di default. Creata a caricamento modulo: multer non la crea da sé.
export function percorsoStorageDocumenti(): string {
  return process.env.DOCUMENTI_STORAGE_PATH ?? path.join(process.cwd(), 'data', 'documenti');
}
mkdirSync(percorsoStorageDocumenti(), { recursive: true });

const MIME_CONSENTITI = new Set(['application/pdf']);
const LIMITE_BYTE = 10 * 1024 * 1024;

// Nome file mai quello dichiarato dal client (path traversal, collisioni): UUID generato
// server-side, estensione presa dal mimetype dichiarato (comunque riverificata sui byte
// reali nella route, vedi Step 8 — il mimetype qui serve solo a scartare subito upload
// palesemente sbagliati prima di scrivere su disco).
export const uploadDocumento = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, percorsoStorageDocumenti()),
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.pdf`),
  }),
  limits: { fileSize: LIMITE_BYTE },
  fileFilter: (_req, file, cb) => {
    cb(null, MIME_CONSENTITI.has(file.mimetype));
  },
}).single('file');
