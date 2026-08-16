import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { generaAccessTokenPubblico } from '../../../backend-node/src/auth/jwtPubblico.ts';
import { generaRefreshToken, hashRefreshToken } from '../../../backend-node/src/auth/refreshToken.ts';

export interface PersonaTest {
  persona: { id: string; codiceFiscale: string; nome: string; cognome: string };
  accessToken: string;
  refreshToken: string;
  // Rimuove la persona di test creata (e la sessione collegata via ON DELETE CASCADE —
  // sessioni_persona_fisica ha la FK a cascata, a differenza di utenti_backoffice/
  // log_operazioni: vedi commento in creaUtenteTest.ts per il caso opposto).
  elimina: () => Promise<void>;
}

export async function creaPersonaTest(dsn: string): Promise<PersonaTest> {
  const pool = new Pool({ connectionString: dsn });
  try {
    const suffisso = randomUUID();
    const r = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Frontend', 'Test', $2, 'spid') RETURNING id`,
      [`FRNTST80A01H501U-${suffisso}`, suffisso],
    );
    const id = r.rows[0]!.id;
    const persona = { id, codiceFiscale: `FRNTST80A01H501U-${suffisso}`, nome: 'Frontend', cognome: 'Test' };
    const accessToken = generaAccessTokenPubblico({
      sub: id,
      codiceFiscale: persona.codiceFiscale,
      nome: persona.nome,
      cognome: persona.cognome,
    });
    const refreshToken = generaRefreshToken();
    await pool.query(
      `INSERT INTO sessioni_persona_fisica (persona_fisica_id, refresh_token_hash, scade_il)
       VALUES ($1, $2, now() + interval '7 days')`,
      [id, hashRefreshToken(refreshToken)],
    );
    return {
      persona,
      accessToken,
      refreshToken,
      elimina: async () => {
        const poolPulizia = new Pool({ connectionString: dsn });
        try {
          await poolPulizia.query('DELETE FROM persone_fisiche WHERE id = $1', [id]);
        } finally {
          await poolPulizia.end();
        }
      },
    };
  } finally {
    await pool.end();
  }
}
