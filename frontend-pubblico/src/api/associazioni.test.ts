// jsdom (l'ambiente di default di questo progetto, vedi vite.config.ts) espone
// le proprie classi FormData/File/Blob, distinte da quelle native Node/undici
// usate dal fetch reale (jsdom non implementa fetch, quindi quello globale
// resta l'undici di Node): una FormData jsdom passata a quel fetch non viene
// serializzata correttamente come multipart, e il campo 'file' arriva vuoto
// lato backend (415 "file mancante") — riproducibile con qualunque
// combinazione di File jsdom/Node finché il body è una FormData jsdom.
// Forziamo quindi l'ambiente node per l'intero file (l'unico, tra i test API,
// che fa upload multipart reali) cosicché FormData/File/fetch condividano lo
// stesso realm di undici. Contropartita: node puro non ha `localStorage`
// (usato da client.ts) senza flag sperimentale — la funzione impostaTokens/
// rimuoviTokens/apiFetch però la usa a runtime, non a import-time, quindi un
// polyfill minimo in-memory registrato prima di ogni chiamata è sufficiente.
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from '../testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './client.ts';
import { creaAssociazione, caricaDocumento, type Associazione } from './associazioni.ts';

class StorageLocaleFinta implements Storage {
  private mappa = new Map<string, string>();
  get length(): number {
    return this.mappa.size;
  }
  clear(): void {
    this.mappa.clear();
  }
  getItem(chiave: string): string | null {
    return this.mappa.has(chiave) ? this.mappa.get(chiave)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.mappa.keys())[index] ?? null;
  }
  removeItem(chiave: string): void {
    this.mappa.delete(chiave);
  }
  setItem(chiave: string, valore: string): void {
    this.mappa.set(chiave, valore);
  }
}
globalThis.localStorage = new StorageLocaleFinta();

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

// Nessun helper esistente lato frontend per creare una "stagione" di test (a
// differenza di creaPersonaTest, non c'era un blocco precedente che lo
// producesse). Stessa scelta pragmatica del backend
// (server.pubblico.test.ts:creaStagioneTest): inserimento diretto via pg
// nella tabella stagioni_sportive, usando lo stesso Pool/TEST_DATABASE_URL
// già usato da creaPersonaTest.ts. Alternativa scartata: passare da un
// endpoint POST /backoffice/stagioni con un utente backoffice di test —
// avrebbe richiesto anche un helper "creaUtenteBackofficeTest" non ancora
// esistente lato frontend, per un guadagno nullo (la query pg è già il
// pattern condiviso lato backend per lo stesso identico scopo).
async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-api-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

descrivi('associazioni.ts', () => {
  let backend: BackendReale;
  let pool: Pool;
  const personeCreate: PersonaTest[] = [];
  let associazioneCreata: Associazione;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    // Le abilitazioni create da creaAssociazione hanno una FK verso
    // persone_fisiche: p.elimina() da sola violerebbe il vincolo. Ripulisce
    // prima le righe dipendenti (documenti/abilitazioni/associazioni) create
    // durante i test, poi elimina le persone di test.
    const personeIds = personeCreate.map((p) => p.persona.id);
    if (personeIds.length > 0) {
      const associazioniIds = (
        await pool.query<{ associazione_id: string }>(
          'SELECT DISTINCT associazione_id FROM abilitazioni WHERE persona_fisica_id = ANY($1::uuid[]) AND associazione_id IS NOT NULL',
          [personeIds],
        )
      ).rows.map((r) => r.associazione_id);
      if (associazioniIds.length > 0) {
        await pool.query('DELETE FROM associazioni_documenti WHERE associazione_id = ANY($1::uuid[])', [associazioniIds]);
      }
      // log_operazioni ha FK non-cascading verso persone_fisiche e associazioni
      // (creaAssociazione scrive una riga 'accreditamento_associazione').
      await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
      await pool.query('DELETE FROM abilitazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
      if (associazioniIds.length > 0) {
        await pool.query('DELETE FROM associazioni WHERE id = ANY($1::uuid[])', [associazioniIds]);
      }
    }
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.end();
  });

  it('creaAssociazione crea una nuova associazione con abilitazione in_attesa', async () => {
    const p = await creaPersonaTest(dsn!);
    personeCreate.push(p);
    impostaTokens(p.accessToken, p.refreshToken);

    const stagioneId = await creaStagioneTest(pool);

    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD Test API ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-${suffisso}`,
      stagioneId,
    });
    expect(associazione.denominazione).toBe(`ASD Test API ${suffisso}`);

    associazioneCreata = associazione;
  });

  it("caricaDocumento carica un PDF valido su un'associazione propria", async () => {
    // Riusa l'associazione (e il token, ancora impostato) creata nel test
    // precedente: il legale rappresentante che ha creato l'associazione ha
    // un'abilitazione (anche se in_attesa) che l'endpoint upload accetta.
    const pdf = new File([new Blob([Buffer.from('%PDF-1.4\ncontenuto finto')])], 'statuto.pdf', {
      type: 'application/pdf',
    });
    const documento = await caricaDocumento(associazioneCreata.id, pdf, 'statuto');
    expect(documento.tipo).toBe('statuto');
    expect(documento.associazioneId).toBe(associazioneCreata.id);
  });
});
