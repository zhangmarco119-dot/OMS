import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PhaseStatusPage } from './pages/PhaseStatusPage';
import { TaskRoutePage } from './pages/TaskRoutePage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/phase-1" replace />,
  },
  {
    path: '/phase-1',
    element: <PhaseStatusPage />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/app',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'messages', element: <DashboardPage /> },
      { path: 'inventory', element: <TaskRoutePage mode="inventory" /> },
      { path: 'order', element: <TaskRoutePage mode="order" /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'account', element: <AccountPage /> },
      {
        path: 'admin',
        element: (
          <ProtectedRoute requireAdmin>
            <AdminPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
  {
    path: '/admin',
    element: <Navigate to="/app/admin" replace />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
