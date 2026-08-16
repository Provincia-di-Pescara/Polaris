import React from 'react';
import { Landmark, ShieldCheck } from 'lucide-react';
import { avviaLoginOidc } from '../api/auth.ts';

export const LoginView: React.FC = () => (
  <div style={{
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--pa-bg-gray)',
  }}>
    <div style={{
      backgroundColor: 'white',
      borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
      padding: '2.5rem',
      width: '400px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1.25rem',
      textAlign: 'center',
    }}>
      <div style={{
        width: '52px',
        height: '52px',
        borderRadius: '10px',
        background: 'linear-gradient(135deg, #00C5CA 0%, #0066CC 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Landmark size={28} color="white" />
      </div>
      <div>
        <h1 style={{ fontSize: '1.3rem', color: 'var(--pa-blue-dark)', margin: 0 }}>POLARIS</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem', marginTop: '0.35rem' }}>
          Portale Spazi Sportivi — Provincia di Pescara
        </p>
      </div>
      <button onClick={avviaLoginOidc} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
        <ShieldCheck size={18} />
        <span>Accedi con SPID / CIE</span>
      </button>
    </div>
  </div>
);
