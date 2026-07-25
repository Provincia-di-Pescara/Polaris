import type { Pool } from 'pg';

const TTL_SECONDI = 300; // 5 minuti, come da riferimento (ComunicaPA usa lo stesso valore su Redis)

export async function salvaStatoPkce(pool: Pool, state: string, codeVerifier: string): Promise<void> {
  await pool.query(
    `INSERT INTO oidc_stato_pkce (state, code_verifier, scade_il)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [state, codeVerifier, TTL_SECONDI],
  );
}

// Consumo one-shot: DELETE...RETURNING è atomico, un secondo tentativo con lo stesso
// state (replay) trova la riga già cancellata e restituisce null.
export async function consumaStatoPkce(pool: Pool, state: string): Promise<string | null> {
  const risultato = await pool.query<{ code_verifier: string }>(
    `DELETE FROM oidc_stato_pkce WHERE state = $1 AND scade_il > now() RETURNING code_verifier`,
    [state],
  );
  return risultato.rows[0]?.code_verifier ?? null;
}
