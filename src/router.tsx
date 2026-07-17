import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { AccountPage } from './pages/AccountPage';
import { AboutSystemPage } from './pages/AboutSystemPage';
import { AdminAnalyticsPage } from './pages/AdminAnalyticsPage';
import { AdminAttendanceDetailPage } from './pages/AdminAttendanceDetailPage';
import { AdminAttendancePage } from './pages/AdminAttendancePage';
import { AdminPayrollPage } from './pages/AdminPayrollPage';
import { AdminLegacyRedirect } from './pages/AdminLegacyRedirect';
import { AdminProductsPage, AdminUsersPage } from './pages/AdminPage';
import { AdminAnnouncementsPage, AdminSopsPage } from './pages/AdminContentPage';
import { AdminArrivalDetailPage } from './pages/AdminArrivalDetailPage';
import { AdminArrivalsPage } from './pages/AdminArrivalsPage';
import { AdminArrivalSummaryPage } from './pages/AdminArrivalSummaryPage';
import { AdminTaskTemplatesPage } from './pages/AdminTaskTemplatesPage';
import { AdminV2TaskReviewPage } from './pages/AdminV2TaskReviewPage';
import { AdminV2TaskPublishPage, AdminV2TasksPage } from './pages/AdminV2TasksPage';
import { ArrivalEntryPage } from './pages/ArrivalEntryPage';
import { ArrivalHistoryPage } from './pages/ArrivalHistoryPage';
import { ArrivalSuccessPage } from './pages/ArrivalSuccessPage';
import { AnnouncementsPage } from './pages/AnnouncementsPage';
import { AnnouncementDetailPage } from './pages/AnnouncementDetailPage';
import { AppMenuPage } from './pages/AppMenuPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { MyAttendancePage } from './pages/MyAttendancePage';
import { MyPayrollPage } from './pages/MyPayrollPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OperationsHistoryPage } from './pages/OperationsHistoryPage';
import { OvertimePage } from './pages/OvertimePage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { SopLibraryPage } from './pages/SopLibraryPage';
import { SopDetailPage } from './pages/SopDetailPage';
import { SystemManualPage } from './pages/SystemManualPage';
import { TaskRoutePage } from './pages/TaskRoutePage';
import { TodoPage } from './pages/TodoPage';
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
      { path: 'notices', element: <AnnouncementsPage /> },
      { path: 'notices/:noticeId', element: <AnnouncementDetailPage /> },
      { path: 'sops', element: <SopLibraryPage /> },
      { path: 'sops/:sopId', element: <SopDetailPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'operations-history', element: <OperationsHistoryPage /> },
      { path: 'attendance', element: <MyAttendancePage /> },
      { path: 'payroll', element: <MyPayrollPage /> },
      { path: 'overtime', element: <OvertimePage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'account/about', element: <ProtectedRoute requireAdmin><AboutSystemPage /></ProtectedRoute> },
      { path: 'account/about/manual/:manualSlug', element: <ProtectedRoute requireAdmin><SystemManualPage /></ProtectedRoute> },
      { path: 'menu', element: <AppMenuPage /> },
      { path: 'workbench', element: <AppMenuPage /> },
      { path: 'todos', element: <TodoPage /> },
      {
        path: 'admin',
        element: (
          <ProtectedRoute requireAdmin>
            <AdminLegacyRedirect />
          </ProtectedRoute>
        ),
      },
      { path: 'admin/products', element: <ProtectedRoute requireAdmin><AdminProductsPage /></ProtectedRoute> },
      { path: 'admin/users', element: <ProtectedRoute requireAdmin><AdminUsersPage /></ProtectedRoute> },
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
      { path: 'admin/tasks/publish', element: <ProtectedRoute requireAdmin><AdminV2TaskPublishPage /></ProtectedRoute> },
      { path: 'admin/tasks/:taskId', element: <ProtectedRoute requireAdmin><AdminV2TaskReviewPage /></ProtectedRoute> },
      { path: 'admin/content', element: <ProtectedRoute requireAdmin><Navigate to="/app/admin/announcements" replace /></ProtectedRoute> },
      { path: 'admin/announcements', element: <ProtectedRoute requireAdmin><AdminAnnouncementsPage /></ProtectedRoute> },
      { path: 'admin/sops', element: <ProtectedRoute requireAdmin><AdminSopsPage /></ProtectedRoute> },
      { path: 'admin/analytics', element: <ProtectedRoute requireAdmin><AdminAnalyticsPage /></ProtectedRoute> },
      { path: 'admin/attendance', element: <ProtectedRoute requireAdmin><AdminAttendancePage /></ProtectedRoute> },
      { path: 'admin/attendance/:profileId', element: <ProtectedRoute requireAdmin><AdminAttendanceDetailPage /></ProtectedRoute> },
      { path: 'admin/payroll', element: <ProtectedRoute requireAdmin><AdminPayrollPage /></ProtectedRoute> },
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
