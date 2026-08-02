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
// referenzia nessuna riga esistente), 22003 = numeric_field_overflow (un valore numerico
// eccede la precisione/scala della colonna NUMERIC — es. moltiplicatoreMinutiPerPunto con
// più cifre di quante ne ammetta NUMERIC(6,3); trattato come richiesta malformata del
// client, non come 500, coerente con gli altri due codici già mappati qui).
export function comeErroreRiferimentoNonValido(err: unknown): ErroreRiferimentoNonValido | null {
  // Un'istanza già lanciata esplicitamente da una repository (es. validazione applicativa
  // di uno slot fuori dalla stagione della domanda, non un vincolo DB) passa così com'è —
  // le route chiamano tutte comeErroreRiferimentoNonValido(err) nel loro catch, un unico
  // punto di normalizzazione a 400 sia per i codici Postgres sotto sia per questi casi.
  if (err instanceof ErroreRiferimentoNonValido) {
    return err;
  }
  if (err instanceof DatabaseError && (err.code === '22P02' || err.code === '23503' || err.code === '22003')) {
    return new ErroreRiferimentoNonValido('riferimento non valido o identificativo malformato');
  }
  return null;
}

// Guardia di transizione di stato: un'operazione che richiede la macchina a stati in un
// punto preciso (es. ammetti/escludi solo da 'presentata', decisione osservazione solo da
// 'in_esame') la trova altrove. Sempre 409 — la richiesta è sintatticamente valida ma non
// applicabile allo stato corrente della risorsa, stesso motivo di ErroreValoreDuplicato ma
// senza vincolo UNIQUE coinvolto.
export class ErroreStatoNonValidoPerTransizione extends Error {}

// L'ordine delle fasi procedurali (istruttoria prima di blocchi-gara/prima-assegnazione,
// art. B.7 → B.12/B.17) non è imposto dal motore Go (nessuno stato "fase corrente" lì) —
// verificato lato Node prima di innescare la chiamata, guardando se esistono già righe di
// fabbisogni_riconosciuti per la stagione.
export class ErroreOrdineFasiNonRispettato extends Error {}

// pg_try_advisory_xact_lock sulla stagione (coda verso il motore Go) ha fallito: un'altra
// esecuzione (istruttoria/blocchi-gara/prima-assegnazione) è già in corso per la stessa
// stagione. Fallisce SUBITO (non-bloccante), a differenza del vecchio
// pg_advisory_xact_lock — una connessione del pool non resta impegnata per l'intera durata
// (fino a ENGINE_TIMEOUT_MS) di una richiesta accodata dietro un'altra.
export class ErroreElaborazioneInCorso extends Error {}
