BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- STAGIONI SPORTIVE
-- ============================================================
CREATE TABLE stagioni_sportive (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    data_inizio DATE NOT NULL,
    data_fine DATE NOT NULL,
    stato TEXT NOT NULL DEFAULT 'censimento' CHECK (stato IN (
        'censimento', 'bando_aperto', 'istruttoria', 'pubblicazione_istruttoria',
        'blocchi_gara', 'prima_assegnazione', 'concertazione', 'definitiva', 'chiusa'
    )),
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stagioni_date_valide CHECK (data_fine > data_inizio)
);
CREATE UNIQUE INDEX stagioni_sportive_nome_uq ON stagioni_sportive (nome);

-- ============================================================
-- CONFIGURAZIONE DI SISTEMA (tecnica/operativa, non versionata per stagione)
-- SMTP, OIDC, personalizzazione loghi: una riga per chiave (es. 'smtp', 'oidc', 'branding')
-- ============================================================
CREATE TABLE impostazioni_sistema (
    chiave TEXT PRIMARY KEY,
    valore JSONB NOT NULL,
    aggiornata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    aggiornata_da UUID
);

-- ============================================================
-- ALLEGATO PARAMETRICO (versionato, business, editabile da admin via UI)
-- Ogni elaborazione referenzia la versione vigente al momento dell'esecuzione:
-- una rielaborazione storica resta riproducibile anche dopo che l'admin
-- ha cambiato i valori correnti.
-- ============================================================
CREATE TABLE parametrico_versioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    valida_dal TIMESTAMPTZ NOT NULL DEFAULT now(),
    pubblicata_da UUID,
    note TEXT,

    moltiplicatore_minuti_per_punto NUMERIC(10,3) NOT NULL DEFAULT 60.000,
    peso_fascia_pregiata NUMERIC(6,3) NOT NULL DEFAULT 1.250,
    minuti_settimanali_max NUMERIC(10,3) NOT NULL DEFAULT 600.000,
    slot_max_stesso_impianto INTEGER NOT NULL DEFAULT 4,
    fasce_pregiate_max INTEGER NOT NULL DEFAULT 2,
    giornate_gara_max INTEGER NOT NULL DEFAULT 1,
    incremento_squadre_neutro INTEGER NOT NULL DEFAULT 0,
    caa_neutro NUMERIC(6,3) NOT NULL DEFAULT 1.000,
    csd_neutro NUMERIC(6,3) NOT NULL DEFAULT 1.000,
    tolleranza_isf_pct NUMERIC(6,4) NOT NULL DEFAULT 0.0050,
    soglia_mancati_utilizzi_diffida INTEGER NOT NULL DEFAULT 2,
    soglia_mancati_utilizzi_decadenza INTEGER NOT NULL DEFAULT 3,
    soglia_scostamento_dichiarato_pct NUMERIC(6,4) NOT NULL DEFAULT 0.2000,
    soglia_isf_compensazione NUMERIC(6,4) NOT NULL DEFAULT 0.2000,
    retention_log_operazioni_giorni INTEGER NOT NULL DEFAULT 30,

    creata_il TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX parametrico_versioni_valida_dal_idx ON parametrico_versioni (valida_dal DESC);

CREATE TABLE csd_scaglioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parametrico_versione_id UUID NOT NULL REFERENCES parametrico_versioni(id) ON DELETE CASCADE,
    rapporto_fd_fr_min NUMERIC(6,3) NOT NULL,
    rapporto_fd_fr_max NUMERIC(6,3),
    coefficiente NUMERIC(6,3) NOT NULL,
    CONSTRAINT csd_scaglioni_range_valido CHECK (rapporto_fd_fr_max IS NULL OR rapporto_fd_fr_max > rapporto_fd_fr_min)
);

-- ============================================================
-- CLASSIFICAZIONE ATTIVITA (Allegato A — valori normativi, non placeholder)
-- ============================================================
CREATE TABLE classi_attivita (
    codice TEXT PRIMARY KEY,
    descrizione TEXT NOT NULL,
    peso_base INTEGER NOT NULL
);

CREATE TABLE incremento_squadre_scaglioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    squadre_min INTEGER NOT NULL,
    squadre_max INTEGER,
    incremento INTEGER NOT NULL,
    CONSTRAINT incremento_squadre_range_valido CHECK (squadre_max IS NULL OR squadre_max >= squadre_min)
);

CREATE TABLE crs_scaglioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    classe_attivita_codice TEXT NOT NULL REFERENCES classi_attivita(codice),
    livello TEXT,
    crs NUMERIC(6,3) NOT NULL
);

CREATE TABLE caa_scaglioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anni_min NUMERIC(5,2) NOT NULL,
    anni_max NUMERIC(5,2),
    caa NUMERIC(6,3) NOT NULL
);

-- ============================================================
-- IMPIANTI E SETTIMANA TIPO
-- ============================================================
CREATE TABLE istituzioni_scolastiche (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    denominazione TEXT NOT NULL,
    codice_meccanografico TEXT UNIQUE,
    indirizzo TEXT,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE impianti (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    denominazione TEXT NOT NULL,
    istituzione_scolastica_id UUID REFERENCES istituzioni_scolastiche(id),
    indirizzo TEXT,
    creato_il TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE spazi_sportivi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    impianto_id UUID NOT NULL REFERENCES impianti(id) ON DELETE CASCADE,
    denominazione TEXT NOT NULL,
    omologazioni TEXT[],
    note TEXT
);

CREATE TABLE discipline_sportive (
    codice TEXT PRIMARY KEY,
    denominazione TEXT NOT NULL
);

CREATE TABLE spazio_disciplina_compatibile (
    spazio_id UUID NOT NULL REFERENCES spazi_sportivi(id) ON DELETE CASCADE,
    disciplina_codice TEXT NOT NULL REFERENCES discipline_sportive(codice),
    PRIMARY KEY (spazio_id, disciplina_codice)
);

CREATE TABLE slot_settimana_tipo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stagione_id UUID NOT NULL REFERENCES stagioni_sportive(id) ON DELETE CASCADE,
    spazio_id UUID NOT NULL REFERENCES spazi_sportivi(id),
    giorno_settimana SMALLINT NOT NULL CHECK (giorno_settimana BETWEEN 1 AND 7),
    orario_inizio TIME NOT NULL,
    orario_fine TIME NOT NULL,
    durata_minuti INTEGER GENERATED ALWAYS AS (
        (EXTRACT(EPOCH FROM (orario_fine - orario_inizio)) / 60)::integer
    ) STORED,
    pregiata BOOLEAN NOT NULL DEFAULT FALSE,
    indisponibile_permanente BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT,
    CONSTRAINT slot_orario_valido CHECK (orario_fine > orario_inizio),
    EXCLUDE USING gist (
        spazio_id WITH =,
        giorno_settimana WITH =,
        stagione_id WITH =,
        tsrange('2000-01-01'::date + orario_inizio, '2000-01-01'::date + orario_fine) WITH &&
    )
);
CREATE INDEX slot_settimana_tipo_stagione_idx ON slot_settimana_tipo (stagione_id);

-- ============================================================
-- PERSONE FISICHE (autenticazione OIDC — frontend pubblico)
-- ============================================================
CREATE TABLE persone_fisiche (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codice_fiscale TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    cognome TEXT NOT NULL,
    email TEXT,
    oidc_subject TEXT NOT NULL,
    oidc_provider TEXT NOT NULL CHECK (oidc_provider IN ('spid', 'cie', 'eidas')),
    livello_spid SMALLINT,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_accesso_il TIMESTAMPTZ
);
CREATE UNIQUE INDEX persone_fisiche_oidc_uq ON persone_fisiche (oidc_provider, oidc_subject);

-- ============================================================
-- ASSOCIAZIONI
-- ============================================================
CREATE TABLE associazioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    denominazione TEXT NOT NULL,
    codice_fiscale_partita_iva TEXT NOT NULL,
    rna_numero_iscrizione TEXT,
    data_costituzione DATE,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX associazioni_cf_piva_uq ON associazioni (codice_fiscale_partita_iva);

CREATE TABLE associazioni_documenti (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    associazione_id UUID NOT NULL REFERENCES associazioni(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    file_path TEXT NOT NULL,
    caricato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    stagione_id UUID REFERENCES stagioni_sportive(id)
);

-- ============================================================
-- ABILITAZIONI (delega persona_fisica -> associazione o istituzione_scolastica)
-- ============================================================
CREATE TABLE abilitazioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_fisica_id UUID NOT NULL REFERENCES persone_fisiche(id),
    associazione_id UUID REFERENCES associazioni(id),
    istituzione_scolastica_id UUID REFERENCES istituzioni_scolastiche(id),
    stagione_id UUID NOT NULL REFERENCES stagioni_sportive(id),
    titolo TEXT NOT NULL CHECK (titolo IN ('legale_rappresentante', 'delegato')),
    ruolo TEXT NOT NULL CHECK (ruolo IN ('rappresentante', 'operatore')),
    documentazione_path TEXT,
    stato TEXT NOT NULL DEFAULT 'in_attesa' CHECK (stato IN ('in_attesa', 'approvata', 'respinta', 'revocata')),
    motivazione TEXT,
    richiesta_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    decisa_il TIMESTAMPTZ,
    decisa_da UUID,
    revocata_il TIMESTAMPTZ,
    revocata_da_persona_fisica_id UUID REFERENCES persone_fisiche(id),
    CONSTRAINT abilitazioni_soggetto_unico CHECK (
        num_nonnulls(associazione_id, istituzione_scolastica_id) = 1
    )
);
CREATE INDEX abilitazioni_persona_idx ON abilitazioni (persona_fisica_id);
CREATE INDEX abilitazioni_associazione_idx ON abilitazioni (associazione_id);

-- ============================================================
-- BACKOFFICE (utenti provincia — auth locale, no OIDC)
-- ============================================================
CREATE TABLE utenti_backoffice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nome TEXT NOT NULL,
    cognome TEXT NOT NULL,
    ruolo TEXT NOT NULL CHECK (ruolo IN ('admin', 'operatore')),
    stato TEXT NOT NULL DEFAULT 'attivo' CHECK (stato IN ('attivo', 'disattivato')),
    creato_da UUID REFERENCES utenti_backoffice(id),
    creato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_accesso_il TIMESTAMPTZ
);

-- FK differite (dipendevano da utenti_backoffice, creata dopo)
ALTER TABLE impostazioni_sistema
    ADD CONSTRAINT impostazioni_sistema_aggiornata_da_fk FOREIGN KEY (aggiornata_da) REFERENCES utenti_backoffice(id);
ALTER TABLE parametrico_versioni
    ADD CONSTRAINT parametrico_versioni_pubblicata_da_fk FOREIGN KEY (pubblicata_da) REFERENCES utenti_backoffice(id);
ALTER TABLE abilitazioni
    ADD CONSTRAINT abilitazioni_decisa_da_fk FOREIGN KEY (decisa_da) REFERENCES utenti_backoffice(id);

-- ============================================================
-- DOMANDE
-- ============================================================
CREATE TABLE domande (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_protocollo TEXT NOT NULL UNIQUE,
    associazione_id UUID NOT NULL REFERENCES associazioni(id),
    stagione_id UUID NOT NULL REFERENCES stagioni_sportive(id),
    presentata_da_persona_fisica_id UUID NOT NULL REFERENCES persone_fisiche(id),
    presentata_il TIMESTAMPTZ NOT NULL DEFAULT now(),

    numero_tesserati INTEGER NOT NULL DEFAULT 0,
    numero_atleti_partecipanti INTEGER NOT NULL DEFAULT 0,
    numero_squadre INTEGER NOT NULL DEFAULT 0,
    numero_squadre_federali_stagione_precedente INTEGER NOT NULL DEFAULT 0,
    attivita_giovanile BOOLEAN NOT NULL DEFAULT FALSE,
    attivita_agonistica BOOLEAN NOT NULL DEFAULT FALSE,
    attivita_paralimpica_inclusiva BOOLEAN NOT NULL DEFAULT FALSE,
    classe_attivita_codice TEXT REFERENCES classi_attivita(codice),
    livello_campionato TEXT CHECK (livello_campionato IN ('provinciale', 'regionale', 'interregionale', 'nazionale')),

    fabbisogno_minimo_minuti NUMERIC(10,3) NOT NULL,
    fabbisogno_ottimale_minuti NUMERIC(10,3) NOT NULL,

    richiede_giornata_gara BOOLEAN NOT NULL DEFAULT FALSE,

    stato TEXT NOT NULL DEFAULT 'presentata' CHECK (stato IN (
        'presentata', 'ammessa', 'esclusa', 'riesame_richiesto', 'riesame_deciso'
    )),
    motivazione_esclusione TEXT,

    CONSTRAINT domande_fabbisogno_coerente CHECK (fabbisogno_ottimale_minuti >= fabbisogno_minimo_minuti)
);
CREATE INDEX domande_associazione_idx ON domande (associazione_id);
CREATE INDEX domande_stagione_idx ON domande (stagione_id);
CREATE UNIQUE INDEX domande_associazione_stagione_uq ON domande (associazione_id, stagione_id);

CREATE TABLE domanda_discipline (
    domanda_id UUID NOT NULL REFERENCES domande(id) ON DELETE CASCADE,
    disciplina_codice TEXT NOT NULL REFERENCES discipline_sportive(codice),
    PRIMARY KEY (domanda_id, disciplina_codice)
);

CREATE TABLE domanda_impianti_compatibili (
    domanda_id UUID NOT NULL REFERENCES domande(id) ON DELETE CASCADE,
    impianto_id UUID NOT NULL REFERENCES impianti(id),
    PRIMARY KEY (domanda_id, impianto_id)
);

CREATE TABLE preferenze (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domanda_id UUID NOT NULL REFERENCES domande(id) ON DELETE CASCADE,
    slot_id UUID NOT NULL REFERENCES slot_settimana_tipo(id),
    ordine_preferenza INTEGER NOT NULL,
    UNIQUE (domanda_id, slot_id)
);
CREATE INDEX preferenze_slot_idx ON preferenze (slot_id);

CREATE TABLE blocchi_allenamento_richiesti (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domanda_id UUID NOT NULL REFERENCES domande(id) ON DELETE CASCADE
);

CREATE TABLE blocco_allenamento_slot (
    blocco_id UUID NOT NULL REFERENCES blocchi_allenamento_richiesti(id) ON DELETE CASCADE,
    slot_id UUID NOT NULL REFERENCES slot_settimana_tipo(id),
    PRIMARY KEY (blocco_id, slot_id)
);

CREATE TABLE richieste_giornata_gara (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domanda_id UUID NOT NULL REFERENCES domande(id) ON DELETE CASCADE,
    federazione TEXT NOT NULL,
    campionato TEXT NOT NULL,
    categoria TEXT NOT NULL,
    requisiti_tecnici TEXT,
    necessita_impianto_omologato BOOLEAN NOT NULL DEFAULT TRUE,
    stato TEXT NOT NULL DEFAULT 'in_esame' CHECK (stato IN ('in_esame', 'assegnata', 'non_assegnata'))
);

-- ============================================================
-- OSSERVAZIONI / RIESAME (art. 7 Doc Principale, art. B.11)
-- ============================================================
CREATE TABLE osservazioni_istruttoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domanda_id UUID NOT NULL REFERENCES domande(id) ON DELETE CASCADE,
    presentata_da_persona_fisica_id UUID NOT NULL REFERENCES persone_fisiche(id),
    testo TEXT NOT NULL,
    presentata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    stato TEXT NOT NULL DEFAULT 'in_esame' CHECK (stato IN ('in_esame', 'accolta', 'respinta')),
    decisione_motivazione TEXT,
    decisa_il TIMESTAMPTZ,
    decisa_da UUID REFERENCES utenti_backoffice(id)
);

-- ============================================================
-- COEFFICIENTI E FABBISOGNO RICONOSCIUTO
-- ============================================================
CREATE TABLE fabbisogni_riconosciuti (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domanda_id UUID NOT NULL UNIQUE REFERENCES domande(id) ON DELETE CASCADE,
    parametrico_versione_id UUID NOT NULL REFERENCES parametrico_versioni(id),
    peso_base INTEGER NOT NULL,
    incremento_squadre INTEGER NOT NULL,
    fr_calcolato_minuti NUMERIC(10,3) NOT NULL,
    fd_minuti NUMERIC(10,3) NOT NULL,
    fr_finale_minuti NUMERIC(10,3) NOT NULL,
    calcolato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fr_finale_coerente CHECK (fr_finale_minuti = LEAST(fd_minuti, fr_calcolato_minuti))
);

CREATE TABLE coefficienti_associazione (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domanda_id UUID NOT NULL UNIQUE REFERENCES domande(id) ON DELETE CASCADE,
    parametrico_versione_id UUID NOT NULL REFERENCES parametrico_versioni(id),
    crs NUMERIC(6,3) NOT NULL,
    caa NUMERIC(6,3) NOT NULL,
    csd NUMERIC(6,3) NOT NULL,
    cp NUMERIC(9,3) NOT NULL,
    prima_stagione BOOLEAN NOT NULL DEFAULT FALSE,
    calcolato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cp_coerente CHECK (cp = ROUND(crs * caa * csd, 3))
);

-- ============================================================
-- ELABORAZIONI (run del motore Go)
-- ============================================================
CREATE TABLE elaborazioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stagione_id UUID NOT NULL REFERENCES stagioni_sportive(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('blocchi_gara', 'prima_assegnazione', 'riassegnazione_residue')),
    parametrico_versione_id UUID NOT NULL REFERENCES parametrico_versioni(id),
    iniziata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    conclusa_il TIMESTAMPTZ,
    stato TEXT NOT NULL DEFAULT 'in_corso' CHECK (stato IN ('in_corso', 'completata', 'fallita')),
    numero_round_eseguiti INTEGER,
    log_dettaglio JSONB
);

-- ============================================================
-- ASSEGNAZIONI
-- ============================================================
CREATE TABLE assegnazioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES slot_settimana_tipo(id),
    domanda_id UUID NOT NULL REFERENCES domande(id),
    associazione_id UUID NOT NULL REFERENCES associazioni(id),
    elaborazione_id UUID REFERENCES elaborazioni(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('singola', 'blocco_gara', 'blocco_allenamento')),
    blocco_allenamento_id UUID REFERENCES blocchi_allenamento_richiesti(id),
    richiesta_giornata_gara_id UUID REFERENCES richieste_giornata_gara(id),
    round_numero INTEGER,
    valore_minuti NUMERIC(10,3) NOT NULL,
    isf_al_momento NUMERIC(9,3),
    stato TEXT NOT NULL DEFAULT 'provvisoria' CHECK (stato IN ('provvisoria', 'validata', 'decaduta', 'sostituita')),
    assegnata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    decaduta_il TIMESTAMPTZ,
    decaduta_motivazione TEXT
);
CREATE INDEX assegnazioni_associazione_idx ON assegnazioni (associazione_id);
CREATE INDEX assegnazioni_slot_idx ON assegnazioni (slot_id);
CREATE UNIQUE INDEX assegnazioni_slot_attiva_uq ON assegnazioni (slot_id) WHERE stato IN ('provvisoria', 'validata');

-- ============================================================
-- SORTEGGIO TRACCIATO (art. B.38 — HMAC-SHA256 rank-asc, vedi CLAUDE.md)
-- ============================================================
CREATE TABLE sorteggi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    elaborazione_id UUID REFERENCES elaborazioni(id),
    articolo_riferimento TEXT NOT NULL,
    contesto TEXT NOT NULL,
    seme_hex TEXT NOT NULL,
    seme_generato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    algoritmo TEXT NOT NULL DEFAULT 'hmac-sha256-rank-asc',
    algoritmo_versione TEXT NOT NULL DEFAULT 'v1',
    vincitore_associazione_id UUID NOT NULL REFERENCES associazioni(id),
    hash_verbale TEXT NOT NULL
);

CREATE TABLE sorteggio_candidati (
    sorteggio_id UUID NOT NULL REFERENCES sorteggi(id) ON DELETE CASCADE,
    associazione_id UUID NOT NULL REFERENCES associazioni(id),
    ordine_canonico INTEGER NOT NULL,
    hmac_hex TEXT NOT NULL,
    rank INTEGER NOT NULL,
    PRIMARY KEY (sorteggio_id, associazione_id)
);

-- ============================================================
-- CONCERTAZIONE (lock ottimistico + FIFO, vedi CLAUDE.md)
-- ============================================================
CREATE TABLE concertazione_proposte (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stagione_id UUID NOT NULL REFERENCES stagioni_sportive(id),
    tipo TEXT NOT NULL CHECK (tipo IN (
        'scambio_bilaterale', 'scambio_multilaterale', 'cessione',
        'utilizzo_slot_libero', 'accorpamento', 'ampliamento'
    )),
    proponente_persona_fisica_id UUID NOT NULL REFERENCES persone_fisiche(id),
    proponente_associazione_id UUID NOT NULL REFERENCES associazioni(id),
    stato TEXT NOT NULL DEFAULT 'in_attesa_accettazione' CHECK (stato IN (
        'in_attesa_accettazione', 'accettata_da_tutti', 'validata', 'rigettata', 'annullata'
    )),
    versione INTEGER NOT NULL DEFAULT 1,
    motivazione_rigetto TEXT,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    validata_il TIMESTAMPTZ,
    validata_da UUID REFERENCES utenti_backoffice(id)
);

CREATE TABLE concertazione_proposta_parti (
    proposta_id UUID NOT NULL REFERENCES concertazione_proposte(id) ON DELETE CASCADE,
    associazione_id UUID NOT NULL REFERENCES associazioni(id),
    accettato_il TIMESTAMPTZ,
    accettato_da_persona_fisica_id UUID REFERENCES persone_fisiche(id),
    PRIMARY KEY (proposta_id, associazione_id)
);

CREATE TABLE concertazione_proposta_slot (
    proposta_id UUID NOT NULL REFERENCES concertazione_proposte(id) ON DELETE CASCADE,
    slot_id UUID NOT NULL REFERENCES slot_settimana_tipo(id),
    associazione_cedente_id UUID REFERENCES associazioni(id),
    associazione_ricevente_id UUID REFERENCES associazioni(id),
    PRIMARY KEY (proposta_id, slot_id)
);

-- ============================================================
-- INDISPONIBILITA SOPRAVVENUTE
-- ============================================================
CREATE TABLE indisponibilita_sopravvenute (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES slot_settimana_tipo(id),
    dal DATE NOT NULL,
    al DATE NOT NULL,
    motivo TEXT NOT NULL,
    comunicata_da TEXT NOT NULL CHECK (comunicata_da IN ('istituzione_scolastica', 'ente')),
    comunicata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    notificata_alle_associazioni_il TIMESTAMPTZ,
    slot_recupero_id UUID REFERENCES slot_settimana_tipo(id),
    CONSTRAINT indisponibilita_date_valide CHECK (al >= dal)
);

-- ============================================================
-- MONITORAGGIO UTILIZZO
-- ============================================================
CREATE TABLE utilizzi_effettivi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assegnazione_id UUID NOT NULL REFERENCES assegnazioni(id) ON DELETE CASCADE,
    data DATE NOT NULL,
    esito TEXT NOT NULL CHECK (esito IN (
        'utilizzato', 'non_utilizzato_giustificato', 'non_utilizzato_non_giustificato', 'indisponibilita_impianto'
    )),
    rilevato_tramite TEXT NOT NULL CHECK (rilevato_tramite IN ('registro_impianto', 'autodichiarazione', 'checkin_digitale')),
    note TEXT,
    registrato_il TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX utilizzi_effettivi_assegnazione_idx ON utilizzi_effettivi (assegnazione_id);

CREATE TABLE provvedimenti_mancato_utilizzo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    associazione_id UUID NOT NULL REFERENCES associazioni(id),
    assegnazione_id UUID NOT NULL REFERENCES assegnazioni(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('richiesta_giustificazione', 'diffida', 'decadenza')),
    motivazione TEXT NOT NULL,
    emesso_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    emesso_da UUID REFERENCES utenti_backoffice(id)
);

-- ============================================================
-- CONVENZIONI (efficacia assegnazione presso istituzione scolastica)
-- ============================================================
CREATE TABLE convenzioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assegnazione_id UUID NOT NULL UNIQUE REFERENCES assegnazioni(id) ON DELETE CASCADE,
    istituzione_scolastica_id UUID NOT NULL REFERENCES istituzioni_scolastiche(id),
    stato TEXT NOT NULL DEFAULT 'in_attesa' CHECK (stato IN ('in_attesa', 'perfezionata')),
    confermata_il TIMESTAMPTZ,
    confermata_da_utente_backoffice_id UUID REFERENCES utenti_backoffice(id),
    confermata_da_persona_fisica_id UUID REFERENCES persone_fisiche(id),
    CONSTRAINT convenzioni_confermata_da_uno CHECK (
        stato = 'in_attesa' OR
        num_nonnulls(confermata_da_utente_backoffice_id, confermata_da_persona_fisica_id) = 1
    )
);

-- ============================================================
-- AUDIT LOG (solo operazioni di scrittura — retention gestita a livello applicativo/job,
-- vedi retention_log_operazioni_giorni in parametrico_versioni)
-- ============================================================
CREATE TABLE log_operazioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_fisica_id UUID REFERENCES persone_fisiche(id),
    utente_backoffice_id UUID REFERENCES utenti_backoffice(id),
    associazione_id UUID REFERENCES associazioni(id),
    ruolo TEXT,
    azione TEXT NOT NULL,
    entita_tipo TEXT NOT NULL,
    entita_id UUID,
    dettaglio JSONB,
    ip_address INET,
    avvenuta_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT log_operazioni_attore_unico CHECK (
        num_nonnulls(persona_fisica_id, utente_backoffice_id) = 1
    )
);
CREATE INDEX log_operazioni_avvenuta_il_idx ON log_operazioni (avvenuta_il);
CREATE INDEX log_operazioni_entita_idx ON log_operazioni (entita_tipo, entita_id);

COMMIT;
