import type { RouteObject } from 'react-router';
import { ProtectedRoute } from './auth/ProtectedRoute.tsx';
import { BackofficeLayout } from './components/BackofficeLayout.tsx';
import { LoginView } from './components/LoginView.tsx';
import { ControlRoomView } from './components/ControlRoomView.tsx';
import { ImpiantiSpaziView } from './components/ImpiantiSpaziView.tsx';
import { DelegheAccreditamentiView } from './components/DelegheAccreditamentiView.tsx';
import { ParametriSistemaView } from './components/ParametriSistemaView.tsx';
import { AuditSorteggioView } from './components/AuditSorteggioView.tsx';
import { StatisticheView } from './components/StatisticheView.tsx';

// Albero di route condiviso tra App.tsx (createBrowserRouter, produzione) e i test
// di integrazione del router (createMemoryRouter, con initialEntries) — mantenerlo
// in un unico posto evita che i due possano divergere silenziosamente.
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginView /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <BackofficeLayout />,
        children: [
          { index: true, element: <ControlRoomView /> },
          { path: 'control-room', element: <ControlRoomView /> },
          { path: 'impianti-spazi', element: <ImpiantiSpaziView /> },
          { path: 'deleghe-accreditamenti', element: <DelegheAccreditamentiView /> },
          {
            // Guardia di ruolo aggiuntiva: solo admin (coerente con Sidebar.tsx,
            // che nasconde questa voce di menu agli operatori).
            element: <ProtectedRoute ruoliAmmessi={['admin']} />,
            children: [{ path: 'parametri-sistema', element: <ParametriSistemaView /> }],
          },
          { path: 'audit-sorteggio', element: <AuditSorteggioView /> },
          { path: 'statistiche', element: <StatisticheView /> },
        ],
      },
    ],
  },
];
