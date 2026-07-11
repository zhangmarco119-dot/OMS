/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_V2_ARRIVAL_ENTRY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
