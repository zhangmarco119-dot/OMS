import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { AuthProvider } from './features/auth/AuthContext';
import { ReleaseUpdateGuard } from './features/release/ReleaseUpdateGuard';
import { router } from './router';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReleaseUpdateGuard>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ReleaseUpdateGuard>
  </React.StrictMode>,
);
