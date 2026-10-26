import React from 'react';
import {createRoot} from 'react-dom/client';
import {RouterProvider} from 'react-router-dom';
import {AuthProvider} from '../../src/features/auth/AuthContext';
import {router} from '../../src/router';
import './styles.generated.css';
import './native-overrides.css';
export default async function createApp(){
  await window.__storehubIntlReady;
  const container=document.createElement('div');container.id='root';document.body.appendChild(container);
  const root=createRoot(container);root.render(<AuthProvider><RouterProvider router={router}/></AuthProvider>);return root;
}
