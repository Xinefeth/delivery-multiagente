/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base absoluta de la API en producción, p.ej. https://el-trujillano-api.onrender.com/api */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
