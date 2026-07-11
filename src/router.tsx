import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { ArrivalEntryPage } from './pages/ArrivalEntryPage';
import { ArrivalHistoryPage } from './pages/ArrivalHistoryPage';
import { ArrivalSuccessPage } from './pages/ArrivalSuccessPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { TaskRoutePage } from './pages/TaskRoutePage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/app" replace />,
  },
  {
    path: '/phase-1',
    element: <Navigate to="/app" replace />,
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
      { path: 'arrivals', element: <ArrivalEntryPage /> },
      { path: 'arrivals/history', element: <ArrivalHistoryPage /> },
      { path: 'arrivals/:reportId/success', element: <ArrivalSuccessPage /> },
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
