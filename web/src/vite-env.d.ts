/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin when the front is hosted separately (Vercel). Empty = same origin. */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
