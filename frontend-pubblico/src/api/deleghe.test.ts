import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from '../testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './client.ts';
import { creaAssociazione } from './associazioni.ts';
import { creaSubDelega } from './deleghe.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

// Nome/cognome del Rappresentante Legale devono combaciare con quelli restituiti
// da creaPersonaTest ('Frontend'/'Test', vedi testUtil/creaPersonaTest.ts): la
// validazione anti-frode del backend (server.ts, POST /pubblico/associazioni)
// rifiuta con 400 se la persona autenticata non corrisponde al RL dichiarato.
const referenteTest = {
  nome: 'Luca',
  cognome: 'Bianchi',
  natoA: 'Pescara',
  natoIl: '1980-01-01',
  residenteVia: 'Via Roma 1',
  residenteCitta: 'Pescara',
  cellulare: '3331234567',
  cartaIdentita: 'CI12345',
};

const referenteEmergenzeDaeTest = {
  ...referenteTest,
  daeMarca: 'Marca DAE',
  daeMatricola: 'DAE-001',
  daeScadenza: '2030-01-01',
};

const assicurazioneTest = {
  compagnia: 'Compagnia Assicurativa SpA',
  numeroPolizza: 'POL-001',
  massimale: '1000000.00',
  coperturaDal: '2026-01-01',
  coperturaAl: '2027-01-01',
};

// Stesso pattern di src/api/associazioni.test.ts: nessun helper frontend per
// creare una stagione di test, quindi inserimento diretto via pg (mirror di
// backend-node/src/server.pubblico.test.ts:creaStagioneTest).
async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-api-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

descrivi('deleghe.ts — creaSubDelega', () => {
  let backend: BackendReale;
  let pool: Pool;
  const personeCreate: PersonaTest[] = [];
  const associazioniCreate: string[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    // creaSubDelega crea anche una persona_fisica "shell" per il delegato
    // (non tracciata da PersonaTest/personeCreate) con una propria
    // abilitazione: la ripulitura deve passare dall'associazione, non solo
    // dalle persone create esplicitamente, altrimenti restano righe orfane
    // e — peggio — la FK abilitazioni->persone_fisiche blocca la delete di
    // personeCreate.
    if (associazioniCreate.length > 0) {
      const personeDaAbilitazioni = (
        await pool.query<{ persona_fisica_id: string }>(
          'SELECT DISTINCT persona_fisica_id FROM abilitazioni WHERE associazione_id = ANY($1::uuid[])',
          [associazioniCreate],
        )
      ).rows.map((r) => r.persona_fisica_id);
      await pool.query('DELETE FROM associazioni_documenti WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      // log_operazioni ha FK non-cascading verso associazioni.
      await pool.query('DELETE FROM log_operazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM abilitazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM associazioni WHERE id = ANY($1::uuid[])', [associazioniCreate]);
      const idPersoneTracciate = new Set(personeCreate.map((p) => p.persona.id));
      const idPersoneShell = personeDaAbilitazioni.filter((id) => !idPersoneTracciate.has(id));
      if (idPersoneShell.length > 0) {
        await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [idPersoneShell]);
        await pool.query('DELETE FROM persone_fisiche WHERE id = ANY($1::uuid[])', [idPersoneShell]);
      }
    }
    const personeIds = personeCreate.map((p) => p.persona.id);
    if (personeIds.length > 0) {
      await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
    }
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.end();
  });

  it('rappresentante approvato può delegare un nuovo CF (auto-approvata)', async () => {
    const rappresentante = await creaPersonaTest(dsn!);
    personeCreate.push(rappresentante);
    impostaTokens(rappresentante.accessToken, rappresentante.refreshToken);

    const stagioneId = await creaStagioneTest(pool);

    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD Delega Test ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-${suffisso}`,
      stagioneId,
      rappresentanteLegaleNome: rappresentante.persona.nome,
      rappresentanteLegaleCognome: rappresentante.persona.cognome,
      indirizzoVia: 'Via Milano 10',
      indirizzoCivico: '10',
      indirizzoCitta: 'Pescara',
      email: 'asd-delega-test@example.com',
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
      referenteSicurezza: referenteTest,
      referenteEmergenzeDae: referenteEmergenzeDaeTest,
      assicurazioneRct: assicurazioneTest,
    });
    associazioniCreate.push(associazione.id);

    // creaAssociazione crea l'abilitazione del rappresentante come
    // 'in_attesa' (vedi backend server.pubblico.test.ts): la sub-delega
    // richiede un'abilitazione 'approvata', quindi la promuoviamo via pg
    // esattamente come fa il test backend equivalente.
    await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE associazione_id = $1`, [associazione.id]);

    const delega = await creaSubDelega({
      codiceFiscale: `TSTDEL${randomUUID().slice(0, 10).toUpperCase()}`,
      nome: 'Nuovo',
      cognome: 'Delegato',
      associazioneId: associazione.id,
      stagioneId,
      ruolo: 'operatore',
    });

    expect(delega.stato).toBe('approvata');
    expect(delega.creataDaAbilitazioneId).toBeTruthy();
  });
});
