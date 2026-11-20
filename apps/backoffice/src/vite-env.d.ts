/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base de l'API ; par defaut /api/v1, servi par le meme hote. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
