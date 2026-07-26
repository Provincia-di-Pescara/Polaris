import { Season, Facility, Space, Slot, DelegateRequest, Domanda, ParametricVersion, AuditLogItem, HMACSorteggioVerbale } from './types';

export const mockSeasons: Season[] = [
  {
    id: 'stagione-2026-2027',
    nome: 'Stagione Sportiva 2026/2027',
    dataInizio: '2026-09-01',
    dataFine: '2027-06-30',
    stato: 'assegnazione',
    faseCorrenteNum: 8
  },
  {
    id: 'stagione-2025-2026',
    nome: 'Stagione Sportiva 2025/2026 (Storico)',
    dataInizio: '2025-09-01',
    dataFine: '2026-06-30',
    stato: 'definitiva',
    faseCorrenteNum: 16
  }
];

export const mockFacilities: Facility[] = [
  {
    id: 'imp-01',
    codice: 'PE-PAL-01',
    nome: 'Palestra Liceo Scientifico G. Galilei',
    comune: 'Pescara',
    indirizzo: 'Via Pietro Foscari, 4',
    istitutoScolastico: 'Liceo Scientifico G. Galilei',
    spaziCount: 2
  },
  {
    id: 'imp-02',
    codice: 'PE-PAL-02',
    nome: 'Palasport I.T.C.T. A. Volta',
    comune: 'Pescara',
    indirizzo: 'Via Volta, 12',
    istitutoScolastico: 'I.T.C.T. A. Volta',
    spaziCount: 1
  },
  {
    id: 'imp-03',
    codice: 'MN-PAL-01',
    nome: 'Palestra Istituto E. Alessandrini',
    comune: 'Montesilvano',
    indirizzo: 'Via D\'Agnese, 1',
    istitutoScolastico: 'I.I.S. E. Alessandrini',
    spaziCount: 1
  },
  {
    id: 'imp-04',
    codice: 'SP-PAL-01',
    nome: 'Palestra Liceo F. Masci',
    comune: 'Spoltore',
    indirizzo: 'Via Italia, 88',
    istitutoScolastico: 'Liceo F. Masci',
    spaziCount: 1
  },
  {
    id: 'imp-05',
    codice: 'PN-PAL-01',
    nome: 'Palestra I.O. L. Da Penne',
    comune: 'Penne',
    indirizzo: 'Piazza Luca da Penne, 3',
    istitutoScolastico: 'I.O. Luca da Penne',
    spaziCount: 1
  }
];

export const mockSpaces: Space[] = [
  {
    id: 'spazio-01',
    impiantoId: 'imp-01',
    nomeImpianto: 'Palestra Liceo Scientifico G. Galilei',
    nomeSpazio: 'Campo Principale Parquet',
    omologazioni: ['Pallavolo Serie B', 'Pallacanestro C'],
    copertura: 'coperto',
    fondo: 'Parquet Legno'
  },
  {
    id: 'spazio-02',
    impiantoId: 'imp-01',
    nomeImpianto: 'Palestra Liceo Scientifico G. Galilei',
    nomeSpazio: 'Palestrina Ginnastica',
    omologazioni: ['Ginnastica Artistica', 'Arti Marziali'],
    copertura: 'coperto',
    fondo: 'Gomma Linoleum'
  },
  {
    id: 'spazio-03',
    impiantoId: 'imp-02',
    nomeImpianto: 'Palasport I.T.C.T. A. Volta',
    nomeSpazio: 'PalaVolta Polivalente',
    omologazioni: ['Pallavolo A2/B', 'Calcio a 5 C1', 'Handball'],
    copertura: 'coperto',
    fondo: 'Resina Sintetica'
  }
];

export const mockSlots: Slot[] = [
  {
    id: 'slot-01',
    spazioId: 'spazio-01',
    giornoSettimana: 'Lunedì',
    oraInizio: '17:00',
    oraFine: '19:00',
    durataMinuti: 120,
    isFasciaPregiata: true,
    moltiplicatore: 1.25,
    assegnatoA: 'ASD Pescara Volley',
    tipoAssegnazione: 'round_robin'
  },
  {
    id: 'slot-02',
    spazioId: 'spazio-01',
    giornoSettimana: 'Lunedì',
    oraInizio: '19:00',
    oraFine: '21:00',
    durataMinuti: 120,
    isFasciaPregiata: true,
    moltiplicatore: 1.25,
    assegnatoA: 'ASD Basket Pescara 1976',
    tipoAssegnazione: 'round_robin'
  },
  {
    id: 'slot-03',
    spazioId: 'spazio-01',
    giornoSettimana: 'Martedì',
    oraInizio: '15:00',
    oraFine: '17:00',
    durataMinuti: 120,
    isFasciaPregiata: false,
    moltiplicatore: 1.0,
    assegnatoA: undefined
  },
  {
    id: 'slot-04',
    spazioId: 'spazio-01',
    giornoSettimana: 'Sabato',
    oraInizio: '16:00',
    oraFine: '18:00',
    durataMinuti: 120,
    isFasciaPregiata: true,
    moltiplicatore: 1.25,
    assegnatoA: 'ASD Pescara Volley',
    tipoAssegnazione: 'blocco_gara'
  },
  {
    id: 'slot-05',
    spazioId: 'spazio-01',
    giornoSettimana: 'Sabato',
    oraInizio: '18:00',
    oraFine: '20:00',
    durataMinuti: 120,
    isFasciaPregiata: true,
    moltiplicatore: 1.25,
    assegnatoA: 'ASD Pescara Volley',
    tipoAssegnazione: 'blocco_gara'
  }
];

export const mockDelegateRequests: DelegateRequest[] = [
  {
    id: 'del-101',
    personaFisica: 'Marco Rossi',
    codiceFiscale: 'RSSMRC80A01G482X',
    email: 'marco.rossi@pescaravolley.it',
    associazioneNome: 'ASD Pescara Volley',
    codiceFiscaleAssociazione: '92012340681',
    tipoAssociazione: 'ASD',
    ruoloRichiesto: 'Legale Rappresentante',
    documentoUrl: '/docs/delega_rossi.pdf',
    dataRichiesta: '2026-07-20 10:14',
    stato: 'in_attesa'
  },
  {
    id: 'del-102',
    personaFisica: 'Giulia Bianchi',
    codiceFiscale: 'BNCGLI85M50G482Y',
    email: 'giulia.bianchi@basketpescara.it',
    associazioneNome: 'ASD Basket Pescara 1976',
    codiceFiscaleAssociazione: '92098760682',
    tipoAssociazione: 'ASD',
    ruoloRichiesto: 'Delegato',
    documentoUrl: '/docs/delega_bianchi.pdf',
    dataRichiesta: '2026-07-21 14:30',
    stato: 'in_attesa'
  },
  {
    id: 'del-103',
    personaFisica: 'Alessandro Neri',
    codiceFiscale: 'NRILSN75R12G482Z',
    email: 'alessandro.neri@montesilvanoc5.it',
    associazioneNome: 'SSD Montesilvano Calcio a 5',
    codiceFiscaleAssociazione: '92033440683',
    tipoAssociazione: 'SSD',
    ruoloRichiesto: 'Legale Rappresentante',
    documentoUrl: '/docs/delega_neri.pdf',
    dataRichiesta: '2026-07-18 09:12',
    stato: 'approvata',
    noteOperatore: 'Documento identità e nomina FIPAV verificati.'
  }
];

export const mockDomande: Domanda[] = [
  {
    id: 'dom-01',
    associazioneId: 'ass-01',
    associazioneNome: 'ASD Pescara Volley',
    classeAttivita: 'A',
    squadreFederaliCount: 4,
    fdMinimoMinuti: 360,
    fdOttimaleMinuti: 480,
    frCalcolatoMinuti: 420,
    crs: 1.20,
    caa: 1.00,
    csd: 1.00,
    cp: 1.20,
    isf: 0.857,
    stato: 'ammessa',
    richiedeBloccoGara: true
  },
  {
    id: 'dom-02',
    associazioneId: 'ass-02',
    associazioneNome: 'ASD Basket Pescara 1976',
    classeAttivita: 'A',
    squadreFederaliCount: 3,
    fdMinimoMinuti: 300,
    fdOttimaleMinuti: 420,
    frCalcolatoMinuti: 360,
    crs: 1.15,
    caa: 1.00,
    csd: 1.00,
    cp: 1.15,
    isf: 0.833,
    stato: 'ammessa',
    richiedeBloccoGara: true
  },
  {
    id: 'dom-03',
    associazioneId: 'ass-03',
    associazioneNome: 'SSD Montesilvano Calcio a 5',
    classeAttivita: 'B',
    squadreFederaliCount: 2,
    fdMinimoMinuti: 240,
    fdOttimaleMinuti: 360,
    frCalcolatoMinuti: 300,
    crs: 1.05,
    caa: 1.00,
    csd: 0.95,
    cp: 0.998,
    isf: 0.800,
    stato: 'ammessa',
    richiedeBloccoGara: false
  }
];

export const mockParametricVersions: ParametricVersion[] = [
  {
    id: 2,
    versione: 'v2.0 (Corrente - Delibera 44/2026)',
    validaDal: '2026-06-01',
    creataDa: 'admin@provincia.pescara.it',
    moltiplicatoreMinutiPeso: 60,
    pesoFascePregiate: 1.25,
    limiteMinutiSettimanali: 600,
    limiteSlotImpianto: 4,
    limiteFascePregiate: 2,
    limiteGiornateGara: 1,
    tolleranzaIsfParita: 0.005,
    sogliaMancatoUtilizzoDiffida: 2,
    sogliaMancatoUtilizzoDecadenza: 3,
    isAttiva: true
  },
  {
    id: 1,
    versione: 'v1.0 (Archiviata - Bootstrap 2025)',
    validaDal: '2025-08-15',
    creataDa: 'system-bootstrap',
    moltiplicatoreMinutiPeso: 60,
    pesoFascePregiate: 1.50,
    limiteMinutiSettimanali: 720,
    limiteSlotImpianto: 5,
    limiteFascePregiate: 3,
    limiteGiornateGara: 1,
    tolleranzaIsfParita: 0.005,
    sogliaMancatoUtilizzoDiffida: 2,
    sogliaMancatoUtilizzoDecadenza: 3,
    isAttiva: false
  }
];

export const mockAuditLogs: AuditLogItem[] = [
  {
    id: 'log-889',
    timestamp: '2026-07-26 14:05:12',
    attore: 'operatore.sport@provincia.pescara.it',
    ruoloAttore: 'Operatore Provincia',
    tipoOperazione: 'APPROVAZIONE_DELEGA',
    descrizione: 'Approvata delega per SSD Montesilvano Calcio a 5 (Alessandro Neri)',
    ipAddress: '10.240.12.45'
  },
  {
    id: 'log-888',
    timestamp: '2026-07-26 11:30:00',
    attore: 'admin@provincia.pescara.it',
    ruoloAttore: 'Amministratore',
    tipoOperazione: 'ESECUZIONE_ROUND_ROBIN',
    descrizione: 'Avviata esecuzione Fase 8 (Round-Robin). Generati 12 slot provvisori per 6 associazioni.',
    ipAddress: '10.240.12.10'
  },
  {
    id: 'log-887',
    timestamp: '2026-07-26 11:15:22',
    attore: 'admin@provincia.pescara.it',
    ruoloAttore: 'Amministratore',
    tipoOperazione: 'ESECUZIONE_BLOCCI_GARA',
    descrizione: 'Avviata esecuzione Fase 6 (Blocchi Gara). Generati 4 verbali di sorteggio tracciati HMAC-SHA256.',
    ipAddress: '10.240.12.10'
  }
];

export const mockHMACVerbali: HMACSorteggioVerbale[] = [
  {
    id: 'verbale-0042',
    proceduraId: 'proc-2026-01',
    articoloRiferimento: 'B.14',
    semeHex: '4a8f9c12b7e5d30198f24a00c6b1297eef8910a34b21d59048a12e5c89f07231',
    timestampGenerazione: '2026-07-26 11:15:22',
    algoritmo: 'hmac-sha256-rank-asc',
    vincitoreNome: 'ASD Pescara Volley',
    hashVerbaleHex: '9f83a210b457e6c1289dfc98024a1b5590c4d32a11b68e7f9a8b7c6d5e4f3a2b',
    candidati: [
      {
        associazioneId: 'ass-01',
        associazioneNome: 'ASD Pescara Volley',
        hmacHex: '10ab4f892c90e123456789abcdef0123456789abcdef0123456789abcdef0123',
        rank: 1
      },
      {
        associazioneId: 'ass-02',
        associazioneNome: 'ASD Basket Pescara 1976',
        hmacHex: '78cdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        rank: 2
      }
    ]
  }
];

export const mockProcedurePhases = [
  { num: 1, titolo: 'Quadro Disponibilità Impianti', stato: 'completata', desc: 'Censimento impianti, settimana tipo e fasce pregiate' },
  { num: 2, titolo: 'Presentazione Domande', stato: 'completata', desc: 'Accreditamento e invio fabbisogni da parte delle associazioni' },
  { num: 3, titolo: 'Istruttoria Ammissibilità', stato: 'completata', desc: 'Verifica requisiti formali, affiliazioni e deleghe' },
  { num: 4, titolo: 'Calcolo Parametri Normativi', stato: 'completata', desc: 'Calcolo deterministico FR, CRS, CAA, CSD e CP (Motore Go)' },
  { num: 5, titolo: 'Pubblicazione Esiti & Osservazioni', stato: 'completata', desc: 'Pubblicazione verbale istruttoria e gestione riesami' },
  { num: 6, titolo: 'Assegnazione Blocchi Gara', stato: 'completata', desc: 'Assegnazione atomica dei blocchi gara e sorteggi HMAC B.14' },
  { num: 7, titolo: 'Calcolo ISF Iniziale', stato: 'completata', desc: 'Determinazione VA da blocchi gara e stato di concentrazione' },
  { num: 8, titolo: 'Assegnazione Round-Robin', stato: 'in_corso', desc: 'Assegnazione deterministica ad anello per fasce orarie' },
  { num: 9, titolo: 'Completamento Procedura', stato: 'in_attesa', desc: 'Verifica condizioni di chiusura (B.22.1/2/3)' },
  { num: 10, titolo: 'Pubblicazione Proposta Provvisoria', stato: 'in_attesa', desc: 'Pubblicazione tabellone orari provvisori per tutte le ASD' },
  { num: 11, titolo: 'Concertazione Tra Associazioni', stato: 'in_attesa', desc: 'Modulo per scambi bilaterali di slot tra associazioni' },
  { num: 12, titolo: 'Validazione Proposte Scambio', stato: 'in_attesa', desc: 'Controllo compatibilità serializzato e lock ottimistico' },
  { num: 13, titolo: 'Riassegnazione Fasce Residue', stato: 'in_attesa', desc: 'Round-robin finale su slot rimasti liberi dopo concertazione' },
  { num: 14, titolo: 'Settimana Tipo Definitiva', stato: 'in_attesa', desc: 'Approvazione e pubblicazione del calendario ufficiale stagione' },
  { num: 15, titolo: 'Gestione Stagionale & Monitoraggio', stato: 'in_attesa', desc: 'Monitoraggio utilizzi effettivi, variazioni e sanzioni' },
  { num: 16, titolo: 'Disposizioni Comuni & Audit', stato: 'in_attesa', desc: 'Archiviazione verbali legali per intera stagione + impugnazione' }
];
