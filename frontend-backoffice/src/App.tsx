import React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AuthProvider } from './auth/AuthContext.tsx';
import { ProtectedRoute } from './auth/ProtectedRoute.tsx';
import { BackofficeLayout } from './components/BackofficeLayout.tsx';
import { LoginView } from './components/LoginView.tsx';
import { ControlRoomView } from './components/ControlRoomView.tsx';
import { ImpiantiSpaziView } from './components/ImpiantiSpaziView.tsx';
import { DelegheAccreditamentiView } from './components/DelegheAccreditamentiView.tsx';
import { ParametriSistemaView } from './components/ParametriSistemaView.tsx';
import { AuditSorteggioView } from './components/AuditSorteggioView.tsx';
import { StatisticheView } from './components/StatisticheView.tsx';

const router = createBrowserRouter([
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
          { path: 'parametri-sistema', element: <ParametriSistemaView /> },
          { path: 'audit-sorteggio', element: <AuditSorteggioView /> },
          { path: 'statistiche', element: <StatisticheView /> },
        ],
      },
    ],
  },
]);

export const App: React.FC = () => (
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>
);
