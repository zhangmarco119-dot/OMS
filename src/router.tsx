import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { AdminArrivalDetailPage } from './pages/AdminArrivalDetailPage';
import { AdminArrivalsPage } from './pages/AdminArrivalsPage';
import { AdminArrivalSummaryPage } from './pages/AdminArrivalSummaryPage';
import { AdminTaskTemplatesPage } from './pages/AdminTaskTemplatesPage';
import { AdminV2TaskReviewPage } from './pages/AdminV2TaskReviewPage';
import { AdminV2TasksPage } from './pages/AdminV2TasksPage';
import { ArrivalEntryPage } from './pages/ArrivalEntryPage';
import { ArrivalHistoryPage } from './pages/ArrivalHistoryPage';
import { ArrivalSuccessPage } from './pages/ArrivalSuccessPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { TaskRoutePage } from './pages/TaskRoutePage';
import { V2TaskCenterPage } from './pages/V2TaskCenterPage';
import { V2TaskExecutionPage } from './pages/V2TaskExecutionPage';

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
    errorElement: <RouteErrorPage />,
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
      { path: 'tasks', element: <V2TaskCenterPage /> },
      { path: 'tasks/:taskId', element: <V2TaskExecutionPage /> },
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
      {
        path: 'admin/arrivals',
        element: <ProtectedRoute requireAdmin><AdminArrivalsPage /></ProtectedRoute>,
      },
      {
        path: 'admin/arrivals/summary',
        element: <ProtectedRoute requireAdmin><AdminArrivalSummaryPage /></ProtectedRoute>,
      },
      {
        path: 'admin/arrivals/:reportId',
        element: <ProtectedRoute requireAdmin><AdminArrivalDetailPage /></ProtectedRoute>,
      },
      {
        path: 'admin/task-templates',
        element: <ProtectedRoute requireAdmin><AdminTaskTemplatesPage /></ProtectedRoute>,
      },
      { path: 'admin/tasks', element: <ProtectedRoute requireAdmin><AdminV2TasksPage /></ProtectedRoute> },
      { path: 'admin/tasks/:taskId', element: <ProtectedRoute requireAdmin><AdminV2TaskReviewPage /></ProtectedRoute> },
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
