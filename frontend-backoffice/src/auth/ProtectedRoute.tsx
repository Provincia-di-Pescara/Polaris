import React from 'react';
import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthContext.tsx';

export interface ProtectedRouteProps {
  // Se presente, solo gli utenti col ruolo indicato possono accedere alle rotte
  // figlie — un utente autenticato ma con un ruolo non ammesso viene rimandato
  // a "/" invece di vedere <Outlet/> (coerente con Sidebar.tsx, che già nasconde
  // le voci di menu non ammesse per il ruolo corrente).
  ruoliAmmessi?: Array<'admin' | 'operatore'>;
}

export function ProtectedRoute({ ruoliAmmessi }: ProtectedRouteProps = {}): React.ReactElement {
  const { utente, caricamento } = useAuth();

  if (caricamento) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--pa-text-muted)' }}>
        Caricamento...
      </div>
    );
  }

  if (!utente) {
    return <Navigate to="/login" replace />;
  }

  if (ruoliAmmessi && !ruoliAmmessi.includes(utente.ruolo)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
