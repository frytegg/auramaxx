/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin when the front is hosted separately (Vercel). Empty = same origin. */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Set by vite.config.ts: the id of the build this page came from, also published as /build.json. */
declare const __BUILD_ID__: string
