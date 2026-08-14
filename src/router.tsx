import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { AccountPage } from './pages/AccountPage';
import { AboutSystemPage } from './pages/AboutSystemPage';
import { AdminAnalyticsPage } from './pages/AdminAnalyticsPage';
import { AdminAiReviewPage } from './pages/AdminAiReviewPage';
import { AdminAttendanceDetailPage } from './pages/AdminAttendanceDetailPage';
import { AdminAttendancePage } from './pages/AdminAttendancePage';
import { AdminPayrollPage } from './pages/AdminPayrollPage';
import { AdminOperationLogsPage } from './pages/AdminOperationLogsPage';
import { AdminLegacyRedirect } from './pages/AdminLegacyRedirect';
import { AdminProductsPage, AdminUsersPage } from './pages/AdminPage';
import { AdminProductCorrectionTaskPage } from './pages/AdminProductCorrectionTaskPage';
import { AdminAnnouncementsPage, AdminSopsPage } from './pages/AdminContentPage';
import { AdminArrivalDetailPage } from './pages/AdminArrivalDetailPage';
import { AdminArrivalsPage } from './pages/AdminArrivalsPage';
import { AdminArrivalSummaryPage } from './pages/AdminArrivalSummaryPage';
import { AdminTaskTemplatesPage } from './pages/AdminTaskTemplatesPage';
import { AdminTaxAccountingPage } from './pages/AdminTaxAccountingPage';
import { AdminV2TaskReviewPage } from './pages/AdminV2TaskReviewPage';
import { AdminV2TaskPublishPage, AdminV2TasksPage } from './pages/AdminV2TasksPage';
import { ArrivalEntryPage } from './pages/ArrivalEntryPage';
import { ArrivalCorrectionPage } from './pages/ArrivalCorrectionPage';
import { ArrivalCorrectionReviewPage } from './pages/ArrivalCorrectionReviewPage';
import { ArrivalHistoryPage } from './pages/ArrivalHistoryPage';
import { ArrivalReportDetailPage } from './pages/ArrivalReportDetailPage';
import { ArrivalSuccessPage } from './pages/ArrivalSuccessPage';
import { AnnouncementsPage } from './pages/AnnouncementsPage';
import { AnnouncementDetailPage } from './pages/AnnouncementDetailPage';
import { AppMenuPage } from './pages/AppMenuPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { HistoryTaskDetailPage } from './pages/HistoryTaskDetailPage';
import { LoginPage } from './pages/LoginPage';
import { ManagerEmployeeManagementPage } from './pages/ManagerEmployeeManagementPage';
import { MyAttendancePage } from './pages/MyAttendancePage';
import { MyPayrollPage } from './pages/MyPayrollPage';
import { ManagerPayrollConfirmationPage } from './pages/ManagerPayrollConfirmationPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OperationsHistoryPage } from './pages/OperationsHistoryPage';
import { OvertimePage } from './pages/OvertimePage';
import { OperationReportDetailPage } from './pages/OperationReportDetailPage';
import { OperationReportsPage } from './pages/OperationReportsPage';
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
      { path: 'arrivals/corrections/:requestId/review', element: <ArrivalCorrectionReviewPage /> },
      { path: 'arrivals/:reportId/correct', element: <ArrivalCorrectionPage /> },
      { path: 'arrivals/:reportId/success', element: <ArrivalSuccessPage /> },
      { path: 'arrivals/:reportId', element: <ArrivalReportDetailPage /> },
      { path: 'tasks', element: <V2TaskCenterPage /> },
      { path: 'tasks/:taskId', element: <V2TaskExecutionPage /> },
      { path: 'notices', element: <AnnouncementsPage /> },
      { path: 'notices/:noticeId', element: <AnnouncementDetailPage /> },
      { path: 'sops', element: <SopLibraryPage /> },
      { path: 'sops/:sopId', element: <SopDetailPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'history/:taskId', element: <HistoryTaskDetailPage /> },
      { path: 'operations-history', element: <OperationsHistoryPage /> },
      { path: 'attendance', element: <MyAttendancePage /> },
      { path: 'payroll', element: <MyPayrollPage /> },
      { path: 'payroll-confirmations/:payslipId', element: <ProtectedRoute requireTaskReviewer><ManagerPayrollConfirmationPage /></ProtectedRoute> },
      { path: 'overtime', element: <OvertimePage /> },
      { path: 'operation-reports', element: <OperationReportsPage /> },
      { path: 'operation-reports/:reportId', element: <OperationReportDetailPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'account/about', element: <ProtectedRoute><AboutSystemPage /></ProtectedRoute> },
      { path: 'account/about/manual/:manualSlug', element: <ProtectedRoute><SystemManualPage /></ProtectedRoute> },
      { path: 'menu', element: <AppMenuPage /> },
      { path: 'manager/employees', element: <ManagerEmployeeManagementPage /> },
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
      { path: 'admin/ai-review', element: <ProtectedRoute requireAdmin><AdminAiReviewPage /></ProtectedRoute> },
      { path: 'admin/products/correction-task', element: <ProtectedRoute requireAdmin><AdminProductCorrectionTaskPage /></ProtectedRoute> },
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
      { path: 'admin/tasks/:taskId', element: <ProtectedRoute requireTaskReviewer><AdminV2TaskReviewPage /></ProtectedRoute> },
      { path: 'admin/content', element: <ProtectedRoute requireAdmin><Navigate to="/app/admin/announcements" replace /></ProtectedRoute> },
      { path: 'admin/announcements', element: <ProtectedRoute requireAdmin><AdminAnnouncementsPage /></ProtectedRoute> },
      { path: 'admin/sops', element: <ProtectedRoute requireAdmin><AdminSopsPage /></ProtectedRoute> },
      { path: 'admin/analytics', element: <ProtectedRoute requireAdmin><AdminAnalyticsPage /></ProtectedRoute> },
      { path: 'admin/attendance', element: <ProtectedRoute requireAdmin><AdminAttendancePage /></ProtectedRoute> },
      { path: 'admin/attendance/:profileId', element: <ProtectedRoute requireAdmin><AdminAttendanceDetailPage /></ProtectedRoute> },
      { path: 'admin/payroll', element: <ProtectedRoute requireAdmin><AdminPayrollPage /></ProtectedRoute> },
      { path: 'admin/tax-accounting', element: <ProtectedRoute requireAdmin><AdminTaxAccountingPage /></ProtectedRoute> },
      { path: 'admin/operation-logs', element: <ProtectedRoute requireAdmin><AdminOperationLogsPage /></ProtectedRoute> },
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
