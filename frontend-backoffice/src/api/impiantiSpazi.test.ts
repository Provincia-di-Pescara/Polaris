import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { impostaTokens, rimuoviTokens } from './client.ts';
import {
  listaDiscipline, creaDisciplina, aggiornaDisciplina,
  listaIstituzioni, creaIstituzione,
  listaImpianti, creaImpianto,
  listaSpaziPerImpianto, creaSpazio,
  listaSlot, creaSlot,
  ErroreRichiestaApi,
} from './impiantiSpazi.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('impiantiSpazi', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];

  async function loginComeAdmin(): Promise<void> {
    const u = await creaUtenteTest(dsn!, 'admin');
    utentiCreati.push(u);
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);
  }

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  it('crea, lista e aggiorna una disciplina', async () => {
    await loginComeAdmin();
    const codice = `TEST-${randomUUID().slice(0, 8)}`;
    const creata = await creaDisciplina({ codice, denominazione: 'Pallavolo Test' });
    expect(creata.codice).toBe(codice);

    const lista = await listaDiscipline();
    expect(lista.some((d) => d.codice === codice)).toBe(true);

    const aggiornata = await aggiornaDisciplina(codice, 'Pallavolo Test Modificata');
    expect(aggiornata.denominazione).toBe('Pallavolo Test Modificata');
  });

  it('creaDisciplina con codice duplicato lancia ErroreRichiestaApi con status 409', async () => {
    await loginComeAdmin();
    const codice = `TEST-${randomUUID().slice(0, 8)}`;
    await creaDisciplina({ codice, denominazione: 'Prima' });

    await expect(creaDisciplina({ codice, denominazione: 'Seconda' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('crea istituzione, impianto, spazio, slot in catena e li ritrova in lista', async () => {
    await loginComeAdmin();
    const suffisso = randomUUID().slice(0, 8);

    const istituzione = await creaIstituzione({ denominazione: `Istituto Test ${suffisso}` });
    const impianto = await creaImpianto({
      denominazione: `Palestra Test ${suffisso}`,
      istituzioneScolasticaId: istituzione.id,
    });
    const impiantiLista = await listaImpianti();
    expect(impiantiLista.some((i) => i.id === impianto.id)).toBe(true);

    const disciplina = await creaDisciplina({ codice: `TEST-${suffisso}`, denominazione: 'Basket Test' });
    const spazio = await creaSpazio({
      impiantoId: impianto.id,
      denominazione: 'Campo A',
      disciplineCompatibili: [disciplina.codice],
    });
    const spaziLista = await listaSpaziPerImpianto(impianto.id);
    expect(spaziLista).toHaveLength(1);
    expect(spaziLista[0]!.disciplineCompatibili).toEqual([disciplina.codice]);

    const stagioniRes = await fetch(`${backend.baseUrl}/backoffice/stagioni`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${localStorage.getItem('polaris_access_token')}`,
      },
      body: JSON.stringify({
        nome: `Stagione Test ${suffisso}`,
        dataInizio: '2030-09-01',
        dataFine: '2031-06-30',
      }),
    });
    const stagione = await stagioniRes.json();

    const slot = await creaSlot({
      stagioneId: stagione.id,
      spazioId: spazio.id,
      giornoSettimana: 1,
      orarioInizio: '18:00',
      orarioFine: '19:00',
      pregiata: true,
    });
    expect(slot.durataMinuti).toBe(60);

    const slotLista = await listaSlot(stagione.id, spazio.id);
    expect(slotLista).toHaveLength(1);
    expect(slotLista[0]!.pregiata).toBe(true);
  });

  it('istituzioni non trovate su aggiornamento producono ErroreRichiestaApi status 404', async () => {
    await loginComeAdmin();
    const { aggiornaIstituzione } = await import('./impiantiSpazi.ts');
    await expect(
      aggiornaIstituzione(randomUUID(), { denominazione: 'Non esiste' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
