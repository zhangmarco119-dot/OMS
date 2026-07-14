/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The guard owns environment-file selection because Git branches and Vite modes
// are intentionally different concepts in this project.
// @ts-expect-error The executable ESM guard is plain JavaScript by design.
import { verifyCurrentEnvironment } from './scripts/verify-environment.mjs';

export default defineConfig(({ mode }) => {
  if (mode !== 'test') {
    const result = verifyCurrentEnvironment();
    if (result.errors.length) {
      console.error('StoreHub 环境校验失败：');
      result.errors.forEach((error: string) => console.error(`- ${error}`));
      throw new Error('StoreHub environment validation failed.');
    }

    for (const key of [
      'VITE_APP_ENV',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_ENABLE_V2_ARRIVAL_ENTRY',
      'VITE_ENABLE_V2_TASK_TEMPLATES',
    ]) {
      const value = result.env[key];
      if (value !== undefined) process.env[key] = value;
    }
    console.log(`StoreHub 环境校验通过：${result.branch} -> ${result.expectedEnvironment} (${result.expectedProjectRef})`);
  }

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            xlsx: ['xlsx'],
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      globals: true,
    },
  };
});
