import React, { useState, useEffect } from 'react';
import { creaSubDelega, type EntitaRappresentata } from '../api/deleghe.ts';
import { creaAssociazione, caricaDocumento, type DatiCreaAssociazione, type TipologiaSoggetto } from '../api/associazioni.ts';
import { listaOrganismiSportivi, type OrganismoSportivo } from '../api/organismiSportivi.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import type { PersonaAutenticata } from '../api/auth.ts';
import { CheckCircle2, Shield, Building2, Plus, FileCheck2 } from 'lucide-react';

const TIPOLOGIA_SOGGETTO_OPZIONI: Array<{ value: TipologiaSoggetto; label: string }> = [
  { value: 'associazione_sportiva', label: 'Associazione sportiva affiliata CONI' },
  { value: 'cooperativa_ente_promozione_sportiva', label: 'Cooperativa/ente di promozione sportiva CONI' },
  { value: 'ente_promozione_culturale_giovanile_anziani', label: 'Ente promozione culturale/giovanile/anziani' },
  { value: 'ente_assistenza_handicap_volontariato', label: 'Ente assistenza handicap/volontariato' },
  { value: 'soggetto_singolo_no_profit', label: 'Soggetto singolo/società no-profit (funzione scuola)' },
  { value: 'organizzazione_sindacale', label: 'Organizzazione sindacale (solo riunioni personale scolastico)' },
  { value: 'movimento_partito_politico', label: 'Movimento/partito politico' },
  { value: 'gruppo_privati_circolo', label: 'Gruppo di cittadini/privati/circolo' },
];

interface AccreditamentoDelegaProps {
  entities: EntitaRappresentata[];
  stagioneId: string | null;
  onRicarica: () => void;
  persona: PersonaAutenticata;
}

const TIPO_DOCUMENTO_OPZIONI: Array<{ value: 'statuto' | 'atto_costitutivo' | 'altro'; label: string }> = [
  { value: 'statuto', label: 'Statuto' },
  { value: 'atto_costitutivo', label: 'Atto Costitutivo' },
  { value: 'altro', label: 'Altro' },
];

export const AccreditamentoDelegaView: React.FC<AccreditamentoDelegaProps> = ({ entities, stagioneId, onRicarica, persona }) => {
  const [showModal, setShowModal] = useState(false);
  const [denominazione, setDenominazione] = useState('');
  const [codiceFiscalePartitaIva, setCodiceFiscalePartitaIva] = useState('');
  const [rnaNumeroIscrizione, setRnaNumeroIscrizione] = useState('');
  const [dataCostituzione, setDataCostituzione] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<'statuto' | 'atto_costitutivo' | 'altro'>('statuto');
  const [file, setFile] = useState<File | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [avvisoUploadFallito, setAvvisoUploadFallito] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const [rappresentanteLegaleNome, setRappresentanteLegaleNome] = useState(persona.nome);
  const [rappresentanteLegaleCognome, setRappresentanteLegaleCognome] = useState(persona.cognome);
  const [delegatoNome, setDelegatoNome] = useState('');
  const [delegatoCognome, setDelegatoCognome] = useState('');
  const [indirizzoVia, setIndirizzoVia] = useState('');
  const [indirizzoCivico, setIndirizzoCivico] = useState('');
  const [indirizzoCitta, setIndirizzoCitta] = useState('');
  const [pec, setPec] = useState('');
  const [email, setEmail] = useState('');
  const [tipologiaSoggetto, setTipologiaSoggetto] = useState<TipologiaSoggetto>('associazione_sportiva');
  const [iscrittaRasd, setIscrittaRasd] = useState(false);
  const [organismoSportivoCodice, setOrganismoSportivoCodice] = useState('');
  const [codiceAffiliazione, setCodiceAffiliazione] = useState('');
  const [haPersonaleAssunto, setHaPersonaleAssunto] = useState(false);
  const [organismi, setOrganismi] = useState<OrganismoSportivo[]>([]);
  const [erroreOrganismi, setErroreOrganismi] = useState<string | null>(null);

  const [refSicurezzaNome, setRefSicurezzaNome] = useState('');
  const [refSicurezzaCognome, setRefSicurezzaCognome] = useState('');
  const [refSicurezzaNatoA, setRefSicurezzaNatoA] = useState('');
  const [refSicurezzaNatoIl, setRefSicurezzaNatoIl] = useState('');
  const [refSicurezzaVia, setRefSicurezzaVia] = useState('');
  const [refSicurezzaCitta, setRefSicurezzaCitta] = useState('');
  const [refSicurezzaCellulare, setRefSicurezzaCellulare] = useState('');
  const [refSicurezzaCartaIdentita, setRefSicurezzaCartaIdentita] = useState('');

  const [refEmergenzeNome, setRefEmergenzeNome] = useState('');
  const [refEmergenzeCognome, setRefEmergenzeCognome] = useState('');
  const [refEmergenzeNatoA, setRefEmergenzeNatoA] = useState('');
  const [refEmergenzeNatoIl, setRefEmergenzeNatoIl] = useState('');
  const [refEmergenzeVia, setRefEmergenzeVia] = useState('');
  const [refEmergenzeCitta, setRefEmergenzeCitta] = useState('');
  const [refEmergenzeCellulare, setRefEmergenzeCellulare] = useState('');
  const [refEmergenzeCartaIdentita, setRefEmergenzeCartaIdentita] = useState('');
  const [daeMarca, setDaeMarca] = useState('');
  const [daeMatricola, setDaeMatricola] = useState('');
  const [daeScadenza, setDaeScadenza] = useState('');

  const [rctCompagnia, setRctCompagnia] = useState('');
  const [rctAgenzia, setRctAgenzia] = useState('');
  const [rctPolizza, setRctPolizza] = useState('');
  const [rctMassimale, setRctMassimale] = useState('');
  const [rctDal, setRctDal] = useState('');
  const [rctAl, setRctAl] = useState('');

  const [rcoCompagnia, setRcoCompagnia] = useState('');
  const [rcoAgenzia, setRcoAgenzia] = useState('');
  const [rcoPolizza, setRcoPolizza] = useState('');
  const [rcoMassimale, setRcoMassimale] = useState('');
  const [rcoDal, setRcoDal] = useState('');
  const [rcoAl, setRcoAl] = useState('');

  const [entitaPerDelega, setEntitaPerDelega] = useState<EntitaRappresentata | null>(null);
  const [cfDelegato, setCfDelegato] = useState('');
  const [nomeDelegato, setNomeDelegato] = useState('');
  const [cognomeDelegato, setCognomeDelegato] = useState('');
  const [ruoloDelegato, setRuoloDelegato] = useState<'rappresentante' | 'operatore'>('operatore');
  const [erroreDelega, setErroreDelega] = useState<string | null>(null);
  const [inCorsoDelega, setInCorsoDelega] = useState(false);

  useEffect(() => {
    listaOrganismiSportivi().then(setOrganismi).catch(() => {
      // Non blocca il resto del form: se il caricamento fallisce, il select resta vuoto,
      // ma segnaliamo l'errore in modo visibile vicino al campo RASD (Finding 1 della
      // code review finale del branch — prima l'errore era silenzioso).
      setErroreOrganismi('Elenco organismi sportivi non disponibile.');
    });
  }, []);

  const handleSubmitDelega = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!entitaPerDelega || entitaPerDelega.associazioneId === null) return;
    setErroreDelega(null);
    setInCorsoDelega(true);
    try {
      await creaSubDelega({
        codiceFiscale: cfDelegato,
        nome: nomeDelegato,
        cognome: cognomeDelegato,
        associazioneId: entitaPerDelega.associazioneId,
        // Stagione dell'abilitazione del delegante su QUESTA associazione, mai
        // una stagione scelta altrove — vedi Global Constraints nel piano.
        stagioneId: entitaPerDelega.stagioneId,
        ruolo: ruoloDelegato,
      });
      onRicarica();
      setEntitaPerDelega(null);
      resetFormDelega();
    } catch (err) {
      setErroreDelega(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante l\'invito.');
    } finally {
      setInCorsoDelega(false);
    }
  };

  const resetForm = (): void => {
    setDenominazione('');
    setCodiceFiscalePartitaIva('');
    setRnaNumeroIscrizione('');
    setDataCostituzione('');
    setFile(null);
    setTipoDocumento('statuto');
    setRappresentanteLegaleNome(persona.nome);
    setRappresentanteLegaleCognome(persona.cognome);
    setDelegatoNome('');
    setDelegatoCognome('');
    setIndirizzoVia('');
    setIndirizzoCivico('');
    setIndirizzoCitta('');
    setPec('');
    setEmail('');
    setTipologiaSoggetto('associazione_sportiva');
    setIscrittaRasd(false);
    setOrganismoSportivoCodice('');
    setCodiceAffiliazione('');
    setHaPersonaleAssunto(false);
    setRefSicurezzaNome('');
    setRefSicurezzaCognome('');
    setRefSicurezzaNatoA('');
    setRefSicurezzaNatoIl('');
    setRefSicurezzaVia('');
    setRefSicurezzaCitta('');
    setRefSicurezzaCellulare('');
    setRefSicurezzaCartaIdentita('');
    setRefEmergenzeNome('');
    setRefEmergenzeCognome('');
    setRefEmergenzeNatoA('');
    setRefEmergenzeNatoIl('');
    setRefEmergenzeVia('');
    setRefEmergenzeCitta('');
    setRefEmergenzeCellulare('');
    setRefEmergenzeCartaIdentita('');
    setDaeMarca('');
    setDaeMatricola('');
    setDaeScadenza('');
    setRctCompagnia('');
    setRctAgenzia('');
    setRctPolizza('');
    setRctMassimale('');
    setRctDal('');
    setRctAl('');
    setRcoCompagnia('');
    setRcoAgenzia('');
    setRcoPolizza('');
    setRcoMassimale('');
    setRcoDal('');
    setRcoAl('');
  };

  const resetFormDelega = (): void => {
    setCfDelegato('');
    setNomeDelegato('');
    setCognomeDelegato('');
    setRuoloDelegato('operatore');
    setErroreDelega(null);
  };

  const apriModaleDelega = (ent: EntitaRappresentata): void => {
    // Difesa in profondità: anche se un percorso precedente avesse lasciato
    // stato residuo, l'apertura di un nuovo modale riparte sempre da un
    // default sicuro (mai 'rappresentante' ereditato da un'altra associazione
    // — vedi Finding 3 della code review finale del branch).
    resetFormDelega();
    setEntitaPerDelega(ent);
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!stagioneId) {
      setErrore('Nessuna stagione selezionata: seleziona una stagione dall\'intestazione prima di procedere.');
      return;
    }
    setErrore(null);
    setAvvisoUploadFallito(null);
    // Verifica lato client, a specchio del controllo anti-spoofing server-side
    // (backend-node/src/server.ts, POST /pubblico/associazioni): non sostituisce
    // il controllo server, che resta l'unico autoritativo, ma evita un round trip
    // inutile quando il nome/cognome dichiarato non combacia con l'identità SPID
    // autenticata (Finding 2 della code review finale del branch).
    const normalizza = (s: string) => s.trim().toLowerCase();
    const nomeAtteso = delegatoNome || rappresentanteLegaleNome;
    const cognomeAtteso = delegatoCognome || rappresentanteLegaleCognome;
    if (normalizza(persona.nome) !== normalizza(nomeAtteso) || normalizza(persona.cognome) !== normalizza(cognomeAtteso)) {
      setErrore('Il nome inserito come Rappresentante Legale (o Delegato) deve corrispondere alla tua identità digitale autenticata.');
      return;
    }
    setInCorso(true);
    try {
      const dati: DatiCreaAssociazione = {
        denominazione,
        codiceFiscalePartitaIva,
        stagioneId,
        ...(rnaNumeroIscrizione ? { rnaNumeroIscrizione } : {}),
        ...(dataCostituzione ? { dataCostituzione } : {}),
        rappresentanteLegaleNome,
        rappresentanteLegaleCognome,
        ...(delegatoNome ? { delegatoNome } : {}),
        ...(delegatoCognome ? { delegatoCognome } : {}),
        indirizzoVia,
        indirizzoCivico,
        indirizzoCitta,
        ...(pec ? { pec } : {}),
        email,
        tipologiaSoggetto,
        iscrittaRasd,
        ...(iscrittaRasd ? { organismoSportivoCodice, codiceAffiliazione } : {}),
        haPersonaleAssunto,
        referenteSicurezza: {
          nome: refSicurezzaNome, cognome: refSicurezzaCognome, natoA: refSicurezzaNatoA, natoIl: refSicurezzaNatoIl,
          residenteVia: refSicurezzaVia, residenteCitta: refSicurezzaCitta, cellulare: refSicurezzaCellulare, cartaIdentita: refSicurezzaCartaIdentita,
        },
        referenteEmergenzeDae: {
          nome: refEmergenzeNome, cognome: refEmergenzeCognome, natoA: refEmergenzeNatoA, natoIl: refEmergenzeNatoIl,
          residenteVia: refEmergenzeVia, residenteCitta: refEmergenzeCitta, cellulare: refEmergenzeCellulare, cartaIdentita: refEmergenzeCartaIdentita,
          daeMarca, daeMatricola, daeScadenza,
        },
        assicurazioneRct: { compagnia: rctCompagnia, ...(rctAgenzia ? { agenzia: rctAgenzia } : {}), numeroPolizza: rctPolizza, massimale: rctMassimale, coperturaDal: rctDal, coperturaAl: rctAl },
        ...(haPersonaleAssunto ? {
          assicurazioneRco: { compagnia: rcoCompagnia, ...(rcoAgenzia ? { agenzia: rcoAgenzia } : {}), numeroPolizza: rcoPolizza, massimale: rcoMassimale, coperturaDal: rcoDal, coperturaAl: rcoAl },
        } : {}),
      };
      const associazione = await creaAssociazione(dati);
      if (file) {
        try {
          await caricaDocumento(associazione.id, file, tipoDocumento);
        } catch (errUpload) {
          // L'associazione è comunque creata: un fallimento dell'upload non deve
          // sembrare un fallimento totale dell'operazione.
          setAvvisoUploadFallito(
            errUpload instanceof ErroreRichiestaApi
              ? `Associazione creata, ma il caricamento del documento è fallito: ${errUpload.message}`
              : 'Associazione creata, ma il caricamento del documento è fallito. Puoi ritentare in seguito.',
          );
        }
      }
      onRicarica();
      setShowModal(false);
      resetForm();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante la richiesta di accreditamento.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
            Gestione Deleghe & Rappresentanza Legale
          </h2>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Accreditamento della tua persona fisica (SPID) a nome delle Associazioni Sportive della Provincia
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">
          <Plus size={16} />
          <span>Richiedi Nuova Delega Rappresentanza</span>
        </button>
      </div>

      {avvisoUploadFallito && (
        <div style={{ backgroundColor: '#FEF9E7', color: '#B7950B', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {avvisoUploadFallito}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {entities.length === 0 && (
          <div className="pa-card" style={{ color: 'var(--pa-text-muted)' }}>
            Nessuna associazione accreditata. Usa "Richiedi Nuova Delega Rappresentanza" per iniziare.
          </div>
        )}
        {entities.map(ent => (
          <div key={ent.id} className="pa-card" style={{ borderTop: '4px solid var(--pa-blue-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <Building2 size={24} color="var(--pa-blue-primary)" />
                <div>
                  <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>{ent.associazioneDenominazione ?? '—'}</h3>
                  <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)' }}>P.IVA / CF: {ent.associazioneCodiceFiscalePartitaIva ?? '—'}</div>
                </div>
              </div>
              {ent.stato === 'approvata' && <span className="badge badge-success"><CheckCircle2 size={12} /> Approvato</span>}
              {ent.stato === 'in_attesa' && <span className="badge badge-warning">In Esame Operatore</span>}
              {ent.stato === 'respinta' && <span className="badge badge-danger">Respinto</span>}
              {ent.stato === 'revocata' && <span className="badge badge-danger">Revocato</span>}
            </div>
            <div style={{ backgroundColor: '#F8FAFC', padding: '0.75rem', borderRadius: '6px', fontSize: '0.825rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--pa-text-muted)' }}>Ruolo:</span>
                <strong>{ent.titolo === 'legale_rappresentante' ? 'Legale Rappresentante' : 'Delegato'} ({ent.ruolo})</strong>
              </div>
            </div>
            {ent.stato === 'approvata' && (
              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => apriModaleDelega(ent)} className="btn btn-secondary btn-sm">
                  <FileCheck2 size={14} /> Invita Delegato
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="pa-card" style={{ backgroundColor: '#EBF5FB', borderLeft: '4px solid var(--pa-blue-primary)' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Shield size={24} color="var(--pa-blue-primary)" style={{ flexShrink: 0 }} />
          <div>
            <h4 style={{ color: 'var(--pa-blue-dark)', fontSize: '1rem' }}>Art. 3 Documento Principale — Tracciabilità Identità Digitale</h4>
            <p style={{ fontSize: '0.85rem', color: '#1B4F72', marginTop: '3px' }}>
              Ogni operazione eseguita nel portale viene associata sia all'identità SPID della persona fisica operante, sia all'associazione rappresentata. La delega viene verificata dagli operatori della Provincia prima dell'ammissione alle domande.
            </p>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--pa-blue-dark)' }}>Richiesta Nuova Delega Rappresentanza</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-denominazione">Denominazione Ufficiale Associazione:</label>
                <input id="acc-denominazione" type="text" required value={denominazione}
                  onChange={(e) => setDenominazione(e.target.value)} placeholder="Es. ASD Pescara Basket" className="form-control" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-cf">Codice Fiscale / P.IVA:</label>
                  <input id="acc-cf" type="text" required value={codiceFiscalePartitaIva}
                    onChange={(e) => setCodiceFiscalePartitaIva(e.target.value)} placeholder="Es. 92012340681" className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rna">Numero Iscrizione RNA (opzionale):</label>
                  <input id="acc-rna" type="text" value={rnaNumeroIscrizione}
                    onChange={(e) => setRnaNumeroIscrizione(e.target.value)} className="form-control" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-data-costituzione">Data Costituzione (opzionale):</label>
                <input id="acc-data-costituzione" type="date" value={dataCostituzione}
                  onChange={(e) => setDataCostituzione(e.target.value)} className="form-control" />
              </div>

              <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>Rappresentante Legale</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rl-nome">Nome:</label>
                  <input id="acc-rl-nome" type="text" required value={rappresentanteLegaleNome}
                    onChange={(e) => setRappresentanteLegaleNome(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rl-cognome">Cognome:</label>
                  <input id="acc-rl-cognome" type="text" required value={rappresentanteLegaleCognome}
                    onChange={(e) => setRappresentanteLegaleCognome(e.target.value)} className="form-control" />
                </div>
              </div>

              <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>Delegato (opzionale)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-delegato-nome">Nome:</label>
                  <input id="acc-delegato-nome" type="text" value={delegatoNome}
                    onChange={(e) => setDelegatoNome(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-delegato-cognome">Cognome:</label>
                  <input id="acc-delegato-cognome" type="text" value={delegatoCognome}
                    onChange={(e) => setDelegatoCognome(e.target.value)} className="form-control" />
                </div>
              </div>

              <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>Indirizzo</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-indirizzo-via">Via:</label>
                  <input id="acc-indirizzo-via" type="text" required value={indirizzoVia}
                    onChange={(e) => setIndirizzoVia(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-indirizzo-civico">Civico:</label>
                  <input id="acc-indirizzo-civico" type="text" required value={indirizzoCivico}
                    onChange={(e) => setIndirizzoCivico(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-indirizzo-citta">Città:</label>
                  <input id="acc-indirizzo-citta" type="text" required value={indirizzoCitta}
                    onChange={(e) => setIndirizzoCitta(e.target.value)} className="form-control" />
                </div>
              </div>

              <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>Contatti</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-pec">PEC (opzionale):</label>
                  <input id="acc-pec" type="email" value={pec}
                    onChange={(e) => setPec(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-email">Email:</label>
                  <input id="acc-email" type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)} className="form-control" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="acc-tipologia-soggetto">Tipologia Soggetto:</label>
                <select id="acc-tipologia-soggetto" value={tipologiaSoggetto}
                  onChange={(e) => setTipologiaSoggetto(e.target.value as TipologiaSoggetto)} className="form-control">
                  {TIPOLOGIA_SOGGETTO_OPZIONI.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>RASD</div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input id="acc-rasd" type="checkbox" checked={iscrittaRasd}
                  onChange={(e) => setIscrittaRasd(e.target.checked)} />
                <label className="form-label" htmlFor="acc-rasd" style={{ margin: 0 }}>Iscritta al Registro Attività Sportiva Dilettantistica (RASD)</label>
              </div>
              {iscrittaRasd && erroreOrganismi && (
                <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', marginBottom: '0.75rem' }}>
                  {erroreOrganismi}
                </div>
              )}
              {iscrittaRasd && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="acc-organismo-sportivo">Organismo Sportivo:</label>
                    <select id="acc-organismo-sportivo" required value={organismoSportivoCodice}
                      onChange={(e) => setOrganismoSportivoCodice(e.target.value)} className="form-control">
                      <option value="">Seleziona…</option>
                      {organismi.map(o => <option key={o.codice} value={o.codice}>{o.denominazione}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="acc-codice-affiliazione">Codice Affiliazione:</label>
                    <input id="acc-codice-affiliazione" type="text" required value={codiceAffiliazione}
                      onChange={(e) => setCodiceAffiliazione(e.target.value)} className="form-control" />
                  </div>
                </div>
              )}

              <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>Assicurazione RCT</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rct-compagnia">Compagnia:</label>
                  <input id="acc-rct-compagnia" type="text" required value={rctCompagnia}
                    onChange={(e) => setRctCompagnia(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rct-agenzia">Agenzia (opzionale):</label>
                  <input id="acc-rct-agenzia" type="text" value={rctAgenzia}
                    onChange={(e) => setRctAgenzia(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rct-polizza">Numero Polizza:</label>
                  <input id="acc-rct-polizza" type="text" required value={rctPolizza}
                    onChange={(e) => setRctPolizza(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rct-massimale">Massimale:</label>
                  <input id="acc-rct-massimale" type="text" required placeholder="Es. 1000000.00" value={rctMassimale}
                    onChange={(e) => setRctMassimale(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rct-dal">Copertura Dal:</label>
                  <input id="acc-rct-dal" type="date" required value={rctDal}
                    onChange={(e) => setRctDal(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rct-al">Copertura Al:</label>
                  <input id="acc-rct-al" type="date" required value={rctAl}
                    onChange={(e) => setRctAl(e.target.value)} className="form-control" />
                </div>
              </div>

              <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>Personale</div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input id="acc-personale-assunto" type="checkbox" checked={haPersonaleAssunto}
                  onChange={(e) => setHaPersonaleAssunto(e.target.checked)} />
                <label className="form-label" htmlFor="acc-personale-assunto" style={{ margin: 0 }}>L'associazione ha personale assunto</label>
              </div>
              {haPersonaleAssunto && (
                <>
                  <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>Assicurazione RCO</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="acc-rco-compagnia">Compagnia:</label>
                      <input id="acc-rco-compagnia" type="text" required value={rcoCompagnia}
                        onChange={(e) => setRcoCompagnia(e.target.value)} className="form-control" />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="acc-rco-agenzia">Agenzia (opzionale):</label>
                      <input id="acc-rco-agenzia" type="text" value={rcoAgenzia}
                        onChange={(e) => setRcoAgenzia(e.target.value)} className="form-control" />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="acc-rco-polizza">Numero Polizza:</label>
                      <input id="acc-rco-polizza" type="text" required value={rcoPolizza}
                        onChange={(e) => setRcoPolizza(e.target.value)} className="form-control" />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="acc-rco-massimale">Massimale:</label>
                      <input id="acc-rco-massimale" type="text" required placeholder="Es. 1000000.00" value={rcoMassimale}
                        onChange={(e) => setRcoMassimale(e.target.value)} className="form-control" />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="acc-rco-dal">Copertura Dal:</label>
                      <input id="acc-rco-dal" type="date" required value={rcoDal}
                        onChange={(e) => setRcoDal(e.target.value)} className="form-control" />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="acc-rco-al">Copertura Al:</label>
                      <input id="acc-rco-al" type="date" required value={rcoAl}
                        onChange={(e) => setRcoAl(e.target.value)} className="form-control" />
                    </div>
                  </div>
                </>
              )}

              <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>Responsabile Sicurezza</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-sic-nome">Nome:</label>
                  <input id="acc-sic-nome" type="text" required value={refSicurezzaNome}
                    onChange={(e) => setRefSicurezzaNome(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-sic-cognome">Cognome:</label>
                  <input id="acc-sic-cognome" type="text" required value={refSicurezzaCognome}
                    onChange={(e) => setRefSicurezzaCognome(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-sic-nato-a">Nato a:</label>
                  <input id="acc-sic-nato-a" type="text" required value={refSicurezzaNatoA}
                    onChange={(e) => setRefSicurezzaNatoA(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-sic-nato-il">Nato il:</label>
                  <input id="acc-sic-nato-il" type="date" required value={refSicurezzaNatoIl}
                    onChange={(e) => setRefSicurezzaNatoIl(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-sic-via">Via:</label>
                  <input id="acc-sic-via" type="text" required value={refSicurezzaVia}
                    onChange={(e) => setRefSicurezzaVia(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-sic-citta">Città:</label>
                  <input id="acc-sic-citta" type="text" required value={refSicurezzaCitta}
                    onChange={(e) => setRefSicurezzaCitta(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-sic-cellulare">Cellulare:</label>
                  <input id="acc-sic-cellulare" type="text" required value={refSicurezzaCellulare}
                    onChange={(e) => setRefSicurezzaCellulare(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-sic-cid">Carta d'Identità:</label>
                  <input id="acc-sic-cid" type="text" required value={refSicurezzaCartaIdentita}
                    onChange={(e) => setRefSicurezzaCartaIdentita(e.target.value)} className="form-control" />
                </div>
              </div>

              <div style={{ fontWeight: 700, marginTop: '1rem', marginBottom: '0.5rem' }}>Responsabile Emergenze e DAE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-eme-nome">Nome:</label>
                  <input id="acc-eme-nome" type="text" required value={refEmergenzeNome}
                    onChange={(e) => setRefEmergenzeNome(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-eme-cognome">Cognome:</label>
                  <input id="acc-eme-cognome" type="text" required value={refEmergenzeCognome}
                    onChange={(e) => setRefEmergenzeCognome(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-eme-nato-a">Nato a:</label>
                  <input id="acc-eme-nato-a" type="text" required value={refEmergenzeNatoA}
                    onChange={(e) => setRefEmergenzeNatoA(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-eme-nato-il">Nato il:</label>
                  <input id="acc-eme-nato-il" type="date" required value={refEmergenzeNatoIl}
                    onChange={(e) => setRefEmergenzeNatoIl(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-eme-via">Via:</label>
                  <input id="acc-eme-via" type="text" required value={refEmergenzeVia}
                    onChange={(e) => setRefEmergenzeVia(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-eme-citta">Città:</label>
                  <input id="acc-eme-citta" type="text" required value={refEmergenzeCitta}
                    onChange={(e) => setRefEmergenzeCitta(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-eme-cellulare">Cellulare:</label>
                  <input id="acc-eme-cellulare" type="text" required value={refEmergenzeCellulare}
                    onChange={(e) => setRefEmergenzeCellulare(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-eme-cid">Carta d'Identità:</label>
                  <input id="acc-eme-cid" type="text" required value={refEmergenzeCartaIdentita}
                    onChange={(e) => setRefEmergenzeCartaIdentita(e.target.value)} className="form-control" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-dae-marca">Marca DAE:</label>
                  <input id="acc-dae-marca" type="text" required value={daeMarca}
                    onChange={(e) => setDaeMarca(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-dae-matricola">Matricola DAE:</label>
                  <input id="acc-dae-matricola" type="text" required value={daeMatricola}
                    onChange={(e) => setDaeMatricola(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-dae-scadenza">Scadenza DAE:</label>
                  <input id="acc-dae-scadenza" type="date" required value={daeScadenza}
                    onChange={(e) => setDaeScadenza(e.target.value)} className="form-control" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="acc-tipo-doc">Tipo Documento (opzionale):</label>
                <select id="acc-tipo-doc" value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value as typeof tipoDocumento)} className="form-control">
                  {TIPO_DOCUMENTO_OPZIONI.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-file">Carica Documento (PDF, opzionale):</label>
                <input id="acc-file" type="file" accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="form-control" />
                {file && (
                  <div style={{ fontWeight: 700, color: 'var(--pa-success)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem' }}>
                    <CheckCircle2 size={16} /> {file.name}
                  </div>
                )}
              </div>
              {errore && (
                <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', marginTop: '0.75rem' }}>
                  {errore}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button type="button" onClick={() => { setShowModal(false); resetForm(); setErrore(null); }} className="btn btn-secondary">Annulla</button>
                <button type="submit" className="btn btn-primary" disabled={inCorso}>
                  {inCorso ? 'Invio in corso…' : 'Invia Delega all\'Operatore'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {entitaPerDelega && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--pa-blue-dark)' }}>
              Invita Delegato per {entitaPerDelega.associazioneDenominazione ?? 'questa associazione'}
            </h3>
            <form onSubmit={handleSubmitDelega}>
              <div className="form-group">
                <label className="form-label" htmlFor="del-cf">Codice Fiscale:</label>
                <input id="del-cf" type="text" required value={cfDelegato} onChange={(e) => setCfDelegato(e.target.value)} className="form-control" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="del-nome">Nome:</label>
                  <input id="del-nome" type="text" required value={nomeDelegato} onChange={(e) => setNomeDelegato(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="del-cognome">Cognome:</label>
                  <input id="del-cognome" type="text" required value={cognomeDelegato} onChange={(e) => setCognomeDelegato(e.target.value)} className="form-control" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="del-ruolo">Ruolo:</label>
                <select id="del-ruolo" value={ruoloDelegato} onChange={(e) => setRuoloDelegato(e.target.value as typeof ruoloDelegato)} className="form-control">
                  <option value="operatore">Operatore</option>
                  {/* Solo un delegante con ruolo 'rappresentante' può assegnare ruolo
                      'rappresentante' — vedi backend-node/src/server.ts:1272-1275.
                      Nascondere l'opzione qui evita un submit destinato al 403. */}
                  {entitaPerDelega.ruolo === 'rappresentante' && <option value="rappresentante">Rappresentante</option>}
                </select>
              </div>
              {erroreDelega && (
                <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', marginTop: '0.75rem' }}>
                  {erroreDelega}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button type="button" onClick={() => { setEntitaPerDelega(null); resetFormDelega(); }} className="btn btn-secondary">Annulla</button>
                <button type="submit" className="btn btn-primary" disabled={inCorsoDelega}>
                  {inCorsoDelega ? 'Invio in corso…' : 'Invia Invito'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
