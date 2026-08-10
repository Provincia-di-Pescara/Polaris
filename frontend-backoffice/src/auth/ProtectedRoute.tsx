import React from 'react';
import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthContext.tsx';

export function ProtectedRoute(): React.ReactElement {
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

  return <Outlet />;
}
