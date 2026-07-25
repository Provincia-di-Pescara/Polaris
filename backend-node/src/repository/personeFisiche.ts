import type { Pool } from 'pg';

export interface PersonaFisica {
  id: string;
  codiceFiscale: string;
  nome: string;
  cognome: string;
}

export interface DatiLoginOidc {
  codiceFiscale: string;
  nome: string;
  cognome: string;
  oidcSubject: string;
  oidcProvider: 'spid' | 'cie' | 'eidas';
}

interface RigaPersona {
  id: string;
  codice_fiscale: string;
  nome: string;
  cognome: string;
}

function daRiga(riga: RigaPersona): PersonaFisica {
  return { id: riga.id, codiceFiscale: riga.codice_fiscale, nome: riga.nome, cognome: riga.cognome };
}

// Lo schema ha DUE vincoli UNIQUE indipendenti su persone_fisiche: codice_fiscale e
// (oidc_provider, oidc_subject). Un singolo ON CONFLICT può risolvere solo uno dei due
// — servono due lookup espliciti (bug reale trovato con smoke test HTTP, non dai test
// automatici iniziali: usare solo (oidc_provider, oidc_subject) come target falliva su
// codice_fiscale se lo stesso CF tornava con un subject diverso; usare solo
// codice_fiscale falliva sull'altro vincolo nel caso opposto).
//
// 1. Match per (provider, subject): stessa sessione/provider di un login precedente.
// 2. Altrimenti match per codice_fiscale: stessa persona, provider/sessione diversi
//    (es. login via SPID una volta e via CIE un'altra) — riusa la riga, aggiorna il subject.
// 3. Altrimenti: prima volta in assoluto, INSERT.
//
// Nota: race TOCTOU teoricamente possibile tra il SELECT e la scrittura sotto richieste
// concorrenti per la stessa persona — accettato per ora (esito nel peggiore dei casi:
// un errore di vincolo univoco raro, non un dato corrotto), non ne vale la pena
// una transazione SERIALIZABLE per un login.
export async function trovaOCreaPersonaFisica(pool: Pool, dati: DatiLoginOidc): Promise<PersonaFisica> {
  const perSubject = await pool.query<RigaPersona>(
    'SELECT id, codice_fiscale, nome, cognome FROM persone_fisiche WHERE oidc_provider = $1 AND oidc_subject = $2',
    [dati.oidcProvider, dati.oidcSubject],
  );
  const rigaPerSubject = perSubject.rows[0];
  if (rigaPerSubject) {
    await pool.query('UPDATE persone_fisiche SET nome = $1, cognome = $2, ultimo_accesso_il = now() WHERE id = $3', [
      dati.nome,
      dati.cognome,
      rigaPerSubject.id,
    ]);
    return daRiga({ ...rigaPerSubject, nome: dati.nome, cognome: dati.cognome });
  }

  const perCf = await pool.query<RigaPersona>(
    'SELECT id, codice_fiscale, nome, cognome FROM persone_fisiche WHERE codice_fiscale = $1',
    [dati.codiceFiscale],
  );
  const rigaPerCf = perCf.rows[0];
  if (rigaPerCf) {
    await pool.query(
      `UPDATE persone_fisiche
       SET nome = $1, cognome = $2, oidc_subject = $3, oidc_provider = $4, ultimo_accesso_il = now()
       WHERE id = $5`,
      [dati.nome, dati.cognome, dati.oidcSubject, dati.oidcProvider, rigaPerCf.id],
    );
    return daRiga({ ...rigaPerCf, nome: dati.nome, cognome: dati.cognome });
  }

  const inserita = await pool.query<RigaPersona>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider, ultimo_accesso_il)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING id, codice_fiscale, nome, cognome`,
    [dati.codiceFiscale, dati.nome, dati.cognome, dati.oidcSubject, dati.oidcProvider],
  );
  const rigaInserita = inserita.rows[0];
  if (!rigaInserita) {
    throw new Error('inserimento persona fisica non ha restituito una riga');
  }
  return daRiga(rigaInserita);
}

export async function trovaPersonaFisicaPerId(pool: Pool, id: string): Promise<PersonaFisica | null> {
  const risultato = await pool.query<RigaPersona>(
    'SELECT id, codice_fiscale, nome, cognome FROM persone_fisiche WHERE id = $1',
    [id],
  );
  const riga = risultato.rows[0];
  return riga ? daRiga(riga) : null;
}
