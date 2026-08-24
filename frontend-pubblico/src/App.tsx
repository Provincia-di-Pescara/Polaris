import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.tsx';
import { LoginView } from './components/LoginView.tsx';
import { OidcCallbackView } from './components/OidcCallbackView.tsx';
import { Header } from './components/Header.tsx';
import { AccreditamentoDelegaView } from './components/AccreditamentoDelegaView';
import { WizardDomandaView } from './components/WizardDomandaView';
import { EsitiIsfView } from './components/EsitiIsfView';
import { ConcertazioneView } from './components/ConcertazioneView';
import { CalendarioDefinitivoView } from './components/CalendarioDefinitivoView';
import type { EntitaRappresentata } from './api/deleghe.ts';
import { listaStagioni, type Stagione } from './api/stagioni.ts';
import { versioneApp } from './sentry.ts';

const AppAutenticata: React.FC = () => {
  const { persona, entities, caricamento, logout, ricarica } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('accreditamento');
  const [activeEntity, setActiveEntity] = useState<EntitaRappresentata | null>(null);
  const [stagioni, setStagioni] = useState<Stagione[]>([]);
  const [stagioneId, setStagioneId] = useState<string | null>(null);

  useEffect(() => {
    // Auto-seleziona solo tra le entità con delega approvata: una entità
    // in_attesa/respinta/revocata non deve mai diventare il contesto operativo
    // attivo di default (vedi anche il filtro nello switcher in Header.tsx).
    const entitaApprovate = entities.filter((e) => e.stato === 'approvata');
    if (entitaApprovate.length > 0 && !activeEntity) {
      setActiveEntity(entitaApprovate[0]!);
    }
  }, [entities, activeEntity]);

  useEffect(() => {
    let annullato = false;
    listaStagioni()
      .then((s) => {
        if (annullato) return;
        setStagioni(s);
        // NIENT'AUTO-SELEZIONE (deciso 2026-08-24, vedi
        // docs/superpowers/specs/2026-08-24-gestione-stagioni-design.md): più
        // stagioni non-chiuse possono coesistere in fasi diverse (una verso la
        // chiusura, la successiva già in censimento) -- "la più recente" non è
        // necessariamente quella su cui il cittadino ha azioni pendenti.
        // Selezione sempre esplicita.
      })
      .catch(() => {
        // Nessuna stagione disponibile non deve bloccare il resto dell'app —
        // il selettore resta vuoto, il flusso di creazione associazione lo
        // segnalerà se l'utente prova a usarlo senza una stagione selezionata.
      });
    return () => {
      annullato = true;
    };
  }, []);

  // Il placeholder a pagina intera va mostrato solo al PRIMO caricamento
  // (nessuna persona ancora nota). Un ricarica() successivo (es. dopo un
  // upload documento fallito) rimette caricamento a true ma non deve
  // smontare l'intero albero autenticato: altrimenti si perde lo stato
  // locale delle view (es. l'avviso di upload fallito in
  // AccreditamentoDelegaView) prima che l'utente possa leggerlo.
  if (caricamento && !persona) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Caricamento…</div>;
  }

  if (!persona) {
    return <LoginView />;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--pa-bg-gray)', display: 'flex', flexDirection: 'column' }}>
      <Header
        persona={persona}
        entities={entities}
        activeEntity={activeEntity}
        setActiveEntity={setActiveEntity}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={logout}
        stagioni={stagioni}
        stagioneId={stagioneId}
        setStagioneId={setStagioneId}
      />

      <main style={{ flex: 1, paddingBottom: '3rem' }}>
        {activeTab === 'accreditamento' && (
          <AccreditamentoDelegaView entities={entities} stagioneId={stagioneId} onRicarica={ricarica} persona={persona} />
        )}
        {activeTab === 'domanda-wizard' && (
          <WizardDomandaView entities={entities} stagioneId={stagioneId} activeEntity={activeEntity} />
        )}
        {activeTab === 'esiti-isf' && (
          <EsitiIsfView entities={entities} stagioneId={stagioneId} activeEntity={activeEntity} />
        )}
        {activeTab === 'concertazione' && (
          <ConcertazioneView entities={entities} stagioneId={stagioneId} activeEntity={activeEntity} />
        )}
        {activeTab === 'calendario-definitivo' && (
          <CalendarioDefinitivoView entities={entities} stagioneId={stagioneId} activeEntity={activeEntity} />
        )}
      </main>

      <footer style={{
        backgroundColor: 'var(--pa-blue-dark)',
        color: 'rgba(255,255,255,0.7)',
        padding: '1.5rem',
        fontSize: '0.8rem',
        textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div><strong>POLARIS</strong> — Provincia di Pescara • Servizio Pubblico Spazi Sportivi Scolastici</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>Conforme Linee Guida AgID & Italia Design System • Accessibilità WCAG 2.1 AA</span>
            <a href="https://github.com/Provincia-di-Pescara/Polaris" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
              GitHub
            </a>
            {versioneApp() && <span>{versioneApp()}</span>}
          </div>
        </div>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  const [inCallback] = useState(window.location.pathname === '/oidc/callback');
  const [callbackCompletato, setCallbackCompletato] = useState(false);

  if (inCallback && !callbackCompletato) {
    return <OidcCallbackView onCompletato={() => setCallbackCompletato(true)} />;
  }

  return (
    <AuthProvider>
      <AppAutenticata />
    </AuthProvider>
  );
};
