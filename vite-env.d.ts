/// <reference types="vite/client" />

declare const __STOREHUB_RELEASE__: {
  buildId: string;
  builtAt: string;
  databaseContract: number;
  environment: 'development' | 'production';
  version: string;
};

interface ImportMetaEnv {
  readonly VITE_ENABLE_V2_ARRIVAL_ENTRY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
