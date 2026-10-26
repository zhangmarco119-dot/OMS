import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.agents',
      '.codex',
      '.codex-remote-attachments',
      '.tmp',
      'dist',
      'coverage',
      'node_modules',
      'reference',
      'qmai-cli-main',
      'android',
      'wechatapp/build',
      'wechatapp/dist',
      'wechatapp/tooling/*.generated.*',
      // Preserved starter templates are outside miniprogramRoot and unused by StoreHub.
      'wechatapp/components',
      'wechatapp/pages',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: ['useAuth'] },
      ],
    },
  },
  {
    files: ['wechatapp/**/*.{js,cjs,ts,tsx}'],
    languageOptions: {globals: Object.fromEntries(['require','module','exports','__dirname','console','process','global','Buffer','URL','AbortController','fetch','Response','setTimeout','clearTimeout','setImmediate','wx','App','Page','Component','getApp','getCurrentPages','__STOREHUB_MINIPROGRAM__'].map(name=>[name,'readonly']))},
    rules: {'@typescript-eslint/no-require-imports':'off'},
  },
  {
    files: ['wechatapp/tooling/native-{controls,jsx-runtime}.{ts,tsx}'],
    // Native Kbone events and custom element properties cross an untyped SDK boundary.
    rules: {'@typescript-eslint/no-explicit-any':'off'},
  },
  {
    files: ['wechatapp/cloudfunctions/bridge/proxy.cjs'],
    // The request guard intentionally rejects C0 control characters.
    rules: {'no-control-regex':'off'},
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['public/_worker.js', 'scripts/development-backend-proxy.test.mjs'],
    languageOptions: {
      globals: { fetch: 'readonly', Request: 'readonly', Response: 'readonly', URL: 'readonly', Headers: 'readonly' },
    },
  },
);
