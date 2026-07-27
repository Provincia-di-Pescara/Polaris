import { DatabaseError } from 'pg';

// Errori di dominio condivisi dalle repository CRUD del backoffice (distinti da
// auth/errori.ts, che è specifico del flusso di autenticazione). Un'unica definizione
// per classe: i controller in server.ts fanno instanceof contro QUESTE classi, non
// contro copie locali per modulo.
export class ErroreValoreDuplicato extends Error {}
export class ErroreNonTrovato extends Error {}

// Riferimento malformato o inesistente passato dal client: un id nel path che non è un
// UUID valido, o un id referenziato nel body (es. istituzioneScolasticaId) che non esiste
// in tabella. In entrambi i casi la richiesta del client è malformata (400), mai un 500
// con l'errore Postgres grezzo esposto al client. Distinto da ErroreValoreDuplicato
// (23505): qui il messaggio non dipende dal campo UNIQUE coinvolto, quindi un'unica
// classe generica basta (a differenza del 23505, gestito per-repository).
export class ErroreRiferimentoNonValido extends Error {}

// Codici Postgres verificati contro Postgres 18 (non assunti, vedi CLAUDE.md):
// 22P02 = invalid_text_representation (qui: un id nel path/body che Postgres non riesce a
// castare a uuid), 23503 = foreign_key_violation (id sintatticamente valido ma che non
// referenzia nessuna riga esistente).
export function comeErroreRiferimentoNonValido(err: unknown): ErroreRiferimentoNonValido | null {
  if (err instanceof DatabaseError && (err.code === '22P02' || err.code === '23503')) {
    return new ErroreRiferimentoNonValido('riferimento non valido o identificativo malformato');
  }
  return null;
}
