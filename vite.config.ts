/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import packageJson from './package.json';

// The guard owns environment-file selection because Git branches and Vite modes
// are intentionally different concepts in this project.
// @ts-expect-error The executable ESM guard is plain JavaScript by design.
import { verifyCurrentEnvironment } from './scripts/verify-environment.mjs';
// @ts-expect-error The executable ESM release helper is plain JavaScript by design.
import { createReleaseManifest, createReleaseMetadata, resolveGitCommit } from './scripts/release-manifest.mjs';

export default defineConfig(({ mode }) => {
  const releaseMetadata = createReleaseMetadata({
    appEnvironment: process.env.VITE_APP_ENV,
    commitSha: resolveGitCommit(process.cwd()),
    packageVersion: packageJson.version,
  });
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
    releaseMetadata.environment = result.expectedEnvironment;
    console.log(`StoreHub 环境校验通过：${result.branch} -> ${result.expectedEnvironment} (${result.expectedProjectRef})`);
  }

  return {
    define: {
      __STOREHUB_RELEASE__: JSON.stringify(releaseMetadata),
    },
    plugins: [
      react(),
      {
        name: 'storehub-release-manifest',
        configureServer(server) {
          server.middlewares.use('/version.json', (_request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify(createReleaseManifest(releaseMetadata)));
          });
        },
        generateBundle() {
          this.emitFile({
            fileName: 'version.json',
            source: `${JSON.stringify(createReleaseManifest(releaseMetadata), null, 2)}\n`,
            type: 'asset',
          });
        },
      },
    ],
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
