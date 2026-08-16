import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { calcolaStatisticheStagione } from './statistiche.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaStagione(pool: Pool): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'prima_assegnazione') RETURNING id`,
    [`stagione-statistiche-test-${randomUUID()}`],
  );
  return r.rows[0]!.id;
}

async function creaAssociazioneEPersona(pool: Pool, etichetta: string): Promise<{ associazioneId: string; personaId: string }> {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD statistiche ${etichetta} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [`TSTSTA${randomUUID().slice(0, 10).toUpperCase()}`, etichetta, randomUUID()],
  );
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id };
}

async function ammettiDomandaConFr(
  pool: Pool,
  domandaId: string,
  frFinaleMinuti: number,
): Promise<void> {
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domandaId]);
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO fabbisogni_riconosciuti (domanda_id, parametrico_versione_id, peso_base, incremento_squadre, fr_calcolato_minuti, fd_minuti, fr_finale_minuti)
     VALUES ($1, $2, 1, 0, $3, $3, $3)`,
    [domandaId, versione.rows[0]!.id, frFinaleMinuti],
  );
}

async function creaAssegnazioneAttiva(pool: Pool, slotId: string, domandaId: string, associazioneId: string, valoreMinuti: number): Promise<void> {
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', $4, 'validata')`,
    [slotId, domandaId, associazioneId, valoreMinuti],
  );
}

test(
  'calcolaStatisticheStagione: KPI e grafici su una stagione con dati misti (pregiate, FR=0, multi-disciplina)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    const discPallavolo = await creaDisciplina(pool, { codice: `STA-VOLLEY-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo test' });
    const discBasket = await creaDisciplina(pool, { codice: `STA-BASKET-${randomUUID().slice(0, 8)}`, denominazione: 'Basket test' });
    const istituzione = await creaIstituzione(pool, { denominazione: `Istituto statistiche ${randomUUID()}` });
    const impianto = await creaImpianto(pool, { denominazione: 'Palestra statistiche', istituzioneScolasticaId: istituzione.id });
    // spazio1: compatibile con ENTRAMBE le discipline (intersezione multi-disciplina)
    const spazio1 = await creaSpazio(pool, {
      impiantoId: impianto.id,
      denominazione: 'Campo 1',
      disciplineCompatibili: [discPallavolo.codice, discBasket.codice],
    });
    const stagioneId = await creaStagione(pool);

    // slot1: NON pregiata, 60 min, assegnata -> utilizzata
    const slot1 = await creaSlot(pool, { stagioneId, spazioId: spazio1.id, giornoSettimana: 1, orarioInizio: '09:00', orarioFine: '10:00' });
    // slot2: PREGIATA, 60 min, assegnata -> utilizzata (pregiata)
    const slot2 = await creaSlot(pool, { stagioneId, spazioId: spazio1.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00', pregiata: true });
    // slot3: PREGIATA, 60 min, MAI assegnata -> conta nel totale pregiate ma non nell'utilizzato
    const slot3 = await creaSlot(pool, { stagioneId, spazioId: spazio1.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00', pregiata: true });

    const { associazioneId: assocA, personaId: personaA } = await creaAssociazioneEPersona(pool, 'A');
    const domandaA = await creaDomanda(
      pool,
      {
        associazioneId: assocA,
        stagioneId,
        disciplineCodici: [discPallavolo.codice, discBasket.codice],
        numeroTesserati: 20,
        numeroAtletiPartecipanti: 15,
        numeroSquadre: 1,
        numeroSquadreFederaliStagionePrecedente: 0,
        attivitaGiovanile: true,
        attivitaAgonistica: false,
        attivitaParalimpicaInclusiva: false,
        fabbisognoMinimoMinuti: '60.000',
        fabbisognoOttimaleMinuti: '120.000',
        preferenze: [slot1.id, slot2.id],
        blocchiAllenamento: [],
        richiedeGiornataGara: false,
        richiesteGiornataGara: [],
      },
      personaA,
    );
    // FR finale = 100: VA cumulativa (slot1=60 + slot2=75 ponderata) = 135 -> ISF = 1.350
    await ammettiDomandaConFr(pool, domandaA.id, 100);
    await creaAssegnazioneAttiva(pool, slot1.id, domandaA.id, assocA, 60);
    await creaAssegnazioneAttiva(pool, slot2.id, domandaA.id, assocA, 75); // ponderata (pregiata), MAI usata nei KPI 1/2

    // Associazione B: FR>0 ma NESSUNA assegnazione attiva -> ISF=0, deve contribuire alla media
    const { associazioneId: assocB, personaId: personaB } = await creaAssociazioneEPersona(pool, 'B');
    const domandaB = await creaDomanda(
      pool,
      {
        associazioneId: assocB,
        stagioneId,
        disciplineCodici: [discPallavolo.codice],
        numeroTesserati: 5,
        numeroAtletiPartecipanti: 4,
        numeroSquadre: 1,
        numeroSquadreFederaliStagionePrecedente: 0,
        attivitaGiovanile: false,
        attivitaAgonistica: false,
        attivitaParalimpicaInclusiva: false,
        fabbisognoMinimoMinuti: '60.000',
        fabbisognoOttimaleMinuti: '60.000',
        preferenze: [slot3.id],
        blocchiAllenamento: [],
        richiedeGiornataGara: false,
        richiesteGiornataGara: [],
      },
      personaB,
    );
    await ammettiDomandaConFr(pool, domandaB.id, 50); // FR=50, VA=0 -> ISF=0

    const stat = await calcolaStatisticheStagione(pool, stagioneId);

    // Totale minuti stagione = slot1(60) + slot2(60) + slot3(60) = 180, utilizzati = slot1+slot2 = 120
    assert.equal(stat.tassoUtilizzoImpiantiPct, '0.667');
    // Pregiate: totale = slot2+slot3 = 120, utilizzate = slot2 = 60
    assert.equal(stat.fascePregiateAssegnatePct, '0.500');
    // ISF medio = AVG(1.350, 0.000) = 0.675 -- associazione A (VA=60+75ponderata=135, FR=100),
    // associazione B (FR=50,VA=0) CONTA nella media
    assert.equal(stat.isfMedioAssociazioni, '0.675');
    // Soci/atleti = 15 (A, ammessa) + 4 (B, ammessa) = 19
    assert.equal(stat.sociAtletiCoinvolti, 19);

    // Disciplina: slot1(60min, intersezione={pallavolo,basket}) split 30/30;
    // slot2(60min, stessa intersezione) split 30/30 -> pallavolo=60, basket=60
    const pallavolo = stat.distribuzioneMinutiPerDisciplina.find((d) => d.disciplinaCodice === discPallavolo.codice);
    const basket = stat.distribuzioneMinutiPerDisciplina.find((d) => d.disciplinaCodice === discBasket.codice);
    assert.equal(pallavolo?.minuti, '60.000');
    assert.equal(basket?.minuti, '60.000');

    // Saturazione per impianto: stesso impianto, stessi totali del KPI 1
    assert.equal(stat.saturazionePerImpianto.length, 1);
    assert.equal(stat.saturazionePerImpianto[0]!.impiantoId, impianto.id);
    assert.equal(stat.saturazionePerImpianto[0]!.tassoUtilizzoPct, '0.667');
  },
);

test(
  'calcolaStatisticheStagione: stagione senza alcun dato ritorna valori null/zero, mai un errore',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());
    const stagioneId = await creaStagione(pool);

    const stat = await calcolaStatisticheStagione(pool, stagioneId);
    assert.equal(stat.tassoUtilizzoImpiantiPct, null);
    assert.equal(stat.fascePregiateAssegnatePct, null);
    assert.equal(stat.isfMedioAssociazioni, null);
    assert.equal(stat.sociAtletiCoinvolti, 0);
    assert.deepEqual(stat.distribuzioneMinutiPerDisciplina, []);
    assert.deepEqual(stat.saturazionePerImpianto, []);
  },
);
