import { z } from 'zod';
import { zDataIso } from './schemaComune.ts';

const REGEX_MASSIMALE = /^\d{1,10}(\.\d{1,2})?$/; // coerente con NUMERIC(12,2) di associazioni_assicurazioni.massimale

const TIPOLOGIE_SOGGETTO = [
  'associazione_sportiva',
  'cooperativa_ente_promozione_sportiva',
  'ente_promozione_culturale_giovanile_anziani',
  'ente_assistenza_handicap_volontariato',
  'soggetto_singolo_no_profit',
  'organizzazione_sindacale',
  'movimento_partito_politico',
  'gruppo_privati_circolo',
] as const;

const schemaReferente = z.object({
  nome: z.string().min(1),
  cognome: z.string().min(1),
  natoA: z.string().min(1),
  natoIl: zDataIso,
  residenteVia: z.string().min(1),
  residenteCitta: z.string().min(1),
  cellulare: z.string().min(1),
  cartaIdentita: z.string().min(1),
});

const schemaReferenteEmergenzeDae = schemaReferente.extend({
  daeMarca: z.string().min(1),
  daeMatricola: z.string().min(1),
  daeScadenza: zDataIso,
});

const schemaAssicurazione = z
  .object({
    compagnia: z.string().min(1),
    agenzia: z.string().min(1).optional(),
    numeroPolizza: z.string().min(1),
    massimale: z.string().regex(REGEX_MASSIMALE),
    coperturaDal: zDataIso,
    coperturaAl: zDataIso,
  })
  .refine((d) => d.coperturaAl > d.coperturaDal, {
    message: 'coperturaAl deve essere successiva a coperturaDal',
    path: ['coperturaAl'],
  });

export const schemaCreaAssociazione = z
  .object({
    denominazione: z.string().min(1),
    codiceFiscalePartitaIva: z.string().min(11).max(16),
    rnaNumeroIscrizione: z.string().min(1).optional(),
    dataCostituzione: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    stagioneId: z.string().uuid(),
    rappresentanteLegaleNome: z.string().min(1),
    rappresentanteLegaleCognome: z.string().min(1),
    delegatoNome: z.string().min(1).optional(),
    delegatoCognome: z.string().min(1).optional(),
    indirizzoVia: z.string().min(1),
    indirizzoCivico: z.string().min(1),
    indirizzoCitta: z.string().min(1),
    pec: z.string().email().optional(),
    email: z.string().email(),
    tipologiaSoggetto: z.enum(TIPOLOGIE_SOGGETTO),
    iscrittaRasd: z.boolean(),
    organismoSportivoCodice: z.string().min(1).optional(),
    codiceAffiliazione: z.string().min(1).optional(),
    haPersonaleAssunto: z.boolean(),
    referenteSicurezza: schemaReferente,
    referenteEmergenzeDae: schemaReferenteEmergenzeDae,
    assicurazioneRct: schemaAssicurazione,
    assicurazioneRco: schemaAssicurazione.optional(),
  })
  .refine((d) => (d.delegatoNome !== undefined) === (d.delegatoCognome !== undefined), {
    message: 'delegatoNome e delegatoCognome devono essere entrambi presenti o entrambi assenti',
    path: ['delegatoCognome'],
  })
  .refine((d) => !d.iscrittaRasd || (d.organismoSportivoCodice !== undefined && d.codiceAffiliazione !== undefined), {
    message: 'organismoSportivoCodice e codiceAffiliazione sono obbligatori se iscrittaRasd è true',
    path: ['organismoSportivoCodice'],
  })
  .refine((d) => d.haPersonaleAssunto === (d.assicurazioneRco !== undefined), {
    message: 'assicurazioneRco è obbligatoria se e solo se haPersonaleAssunto è true',
    path: ['assicurazioneRco'],
  });
export type CreaAssociazioneRequest = z.infer<typeof schemaCreaAssociazione>;

export const schemaCaricaDocumento = z.object({
  tipo: z.enum(['statuto', 'atto_costitutivo', 'altro']),
});

export const schemaCreaDelega = z.object({
  codiceFiscale: z.string().min(11).max(16),
  nome: z.string().min(1),
  cognome: z.string().min(1),
  associazioneId: z.string().uuid(),
  stagioneId: z.string().uuid(),
  ruolo: z.enum(['rappresentante', 'operatore']),
});
export type CreaDelegaRequest = z.infer<typeof schemaCreaDelega>;

const REGEX_MINUTI = /^\d{1,7}(\.\d{1,3})?$/; // coerente con NUMERIC(10,3) di domande.fabbisogno_*_minuti

export const schemaRichiestaGiornataGara = z.object({
  federazione: z.string().min(1),
  campionato: z.string().min(1),
  categoria: z.string().min(1),
  requisitiTecnici: z.string().min(1).optional(),
  necessitaImpiantoOmologato: z.boolean().default(true),
});

export const schemaCreaDomanda = z
  .object({
    associazioneId: z.string().uuid(),
    stagioneId: z.string().uuid(),
    disciplineCodici: z.array(z.string().min(1)).min(1),
    classeAttivitaCodice: z.string().min(1).optional(),
    livelloCampionato: z.enum(['provinciale', 'regionale', 'interregionale', 'nazionale']).optional(),
    numeroTesserati: z.number().int().min(0).default(0),
    numeroAtletiPartecipanti: z.number().int().min(0).default(0),
    numeroSquadre: z.number().int().min(0).default(0),
    numeroSquadreFederaliStagionePrecedente: z.number().int().min(0).default(0),
    attivitaGiovanile: z.boolean().default(false),
    attivitaAgonistica: z.boolean().default(false),
    attivitaParalimpicaInclusiva: z.boolean().default(false),
    fabbisognoMinimoMinuti: z.string().regex(REGEX_MINUTI),
    fabbisognoOttimaleMinuti: z.string().regex(REGEX_MINUTI),
    preferenze: z.array(z.string().uuid()).min(1),
    blocchiAllenamento: z.array(z.array(z.string().uuid()).min(2)).default([]),
    richiedeGiornataGara: z.boolean().default(false),
    richiesteGiornataGara: z.array(schemaRichiestaGiornataGara).default([]),
  })
  .refine((d) => Number(d.fabbisognoOttimaleMinuti) >= Number(d.fabbisognoMinimoMinuti), {
    message: 'fabbisognoOttimaleMinuti deve essere >= fabbisognoMinimoMinuti',
    path: ['fabbisognoOttimaleMinuti'],
  })
  .refine((d) => new Set(d.preferenze).size === d.preferenze.length, {
    message: 'preferenze contiene slotId duplicati',
    path: ['preferenze'],
  })
  .refine((d) => d.blocchiAllenamento.every((blocco) => new Set(blocco).size === blocco.length), {
    message: 'un blocco allenamento contiene slotId duplicati',
    path: ['blocchiAllenamento'],
  })
  .refine(
    (d) => d.blocchiAllenamento.every((blocco) => blocco.every((slotId) => d.preferenze.includes(slotId))),
    { message: 'ogni fascia di un blocco allenamento deve comparire anche tra le preferenze', path: ['blocchiAllenamento'] },
  )
  .refine((d) => !d.richiedeGiornataGara || d.richiesteGiornataGara.length > 0, {
    message: 'richiesteGiornataGara non può essere vuoto se richiedeGiornataGara è true',
    path: ['richiesteGiornataGara'],
  })
  .refine((d) => d.richiedeGiornataGara || d.richiesteGiornataGara.length === 0, {
    message: 'richiesteGiornataGara deve essere vuoto se richiedeGiornataGara è false',
    path: ['richiesteGiornataGara'],
  });
export type CreaDomandaRequest = z.infer<typeof schemaCreaDomanda>;

export const schemaAnteprimaFabbisogno = z.object({
  associazioneId: z.string().uuid(),
  stagioneId: z.string().uuid(),
  classeAttivitaCodice: z.string().min(1),
  livelloCampionato: z.enum(['provinciale', 'regionale', 'interregionale', 'nazionale']).optional(),
  numeroSquadreFederali: z.number().int().min(0),
  fdMinuti: z.string().regex(REGEX_MINUTI),
});
export type AnteprimaFabbisognoRequest = z.infer<typeof schemaAnteprimaFabbisogno>;

export const schemaCreaOsservazione = z.object({
  testo: z.string().min(1),
});
export type CreaOsservazioneRequest = z.infer<typeof schemaCreaOsservazione>;

export const schemaCreaProposta = z
  .object({
    stagioneId: z.string().uuid(),
    // Chi propone (deve essere una delle associazioni coinvolte nei blocchi `slot`, verificato
    // dal chiamante): art. B.24-26 contempla negoziazione avviata da cedente O ricevente, non
    // solo dal cedente del primo slot (che era l'inferenza implicita usata in precedenza).
    proponenteAssociazioneId: z.string().uuid(),
    tipo: z.enum([
      'scambio_bilaterale',
      'scambio_multilaterale',
      'cessione',
      'utilizzo_slot_libero',
      'accorpamento',
      'ampliamento',
    ]),
    slot: z
      .array(
        z.object({
          slotId: z.string().uuid(),
          associazioneCedenteId: z.string().uuid().optional(),
          associazioneRiceventeId: z.string().uuid(),
        }),
      )
      .min(1),
  })
  .refine(
    (d) =>
      d.tipo === 'utilizzo_slot_libero'
        ? d.slot.every((s) => s.associazioneCedenteId === undefined)
        : d.slot.every((s) => s.associazioneCedenteId !== undefined),
    {
      message: "associazioneCedenteId deve essere assente per 'utilizzo_slot_libero', valorizzato per ogni altro tipo",
      path: ['slot'],
    },
  );
export type CreaPropostaRequest = z.infer<typeof schemaCreaProposta>;

export const schemaAccettaProposta = z.object({
  associazioneId: z.string().uuid(),
});
export type AccettaPropostaRequest = z.infer<typeof schemaAccettaProposta>;

export const schemaCreaVariazione = z
  .object({
    stagioneId: z.string().uuid(),
    tipo: z.enum(['liberazione', 'recupero', 'scambio_temporaneo', 'utilizzo_occasionale']),
    associazioneId: z.string().uuid(), // l'associazione del chiamante che agisce (una persona può averne più di una)
    slotId: z.string().uuid(),
    data: zDataIso,
    slotDestinazioneId: z.string().uuid().optional(),
    dataDestinazione: zDataIso.optional(),
    controparteAssociazioneId: z.string().uuid().optional(),
    indisponibilitaId: z.string().uuid().optional(),
  })
  .refine((d) => (d.tipo === 'recupero' || d.tipo === 'scambio_temporaneo') === (d.slotDestinazioneId !== undefined && d.dataDestinazione !== undefined), {
    message: 'slotDestinazioneId e dataDestinazione richiesti solo per recupero e scambio_temporaneo',
    path: ['slotDestinazioneId'],
  })
  .refine((d) => (d.tipo === 'scambio_temporaneo') === (d.controparteAssociazioneId !== undefined), {
    message: 'controparteAssociazioneId richiesto solo per scambio_temporaneo',
    path: ['controparteAssociazioneId'],
  })
  // art. B.33: un recupero esiste solo a fronte di un'indisponibilità sopravvenuta reale.
  // Senza questo vincolo `recupero` era una richiesta libera su una fascia qualsiasi
  // (C1 final review); la corrispondenza fascia/data dell'indisponibilità è poi verificata
  // in variazioni.ts, qui si impone solo la presenza del riferimento.
  .refine((d) => (d.tipo === 'recupero') === (d.indisponibilitaId !== undefined), {
    message: 'indisponibilitaId è obbligatorio per un recupero e ammesso solo per un recupero',
    path: ['indisponibilitaId'],
  })
  .refine((d) => d.controparteAssociazioneId !== d.associazioneId, {
    message: 'la controparte non può essere la stessa associazione richiedente',
    path: ['controparteAssociazioneId'],
  });
export type CreaVariazioneRequest = z.infer<typeof schemaCreaVariazione>;

export const schemaAccettaVariazione = z.object({
  associazioneId: z.string().uuid(),
});
export type AccettaVariazioneRequest = z.infer<typeof schemaAccettaVariazione>;

export const schemaPresentaGiustificazione = z.object({
  testo: z.string().min(1),
});
export type PresentaGiustificazioneRequest = z.infer<typeof schemaPresentaGiustificazione>;
