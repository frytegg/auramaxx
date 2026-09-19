/**
 * Where the backend lives.
 *
 * Same origin by default, which is how it runs on Render. Set VITE_API_BASE at build time to
 * point a statically hosted front (Vercel) at the Render backend instead — the WebSocket, the
 * REST calls and the join QR then all follow that one setting, so they can never disagree.
 */
const configured = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

export const API_BASE = configured || window.location.origin

export const WS_URL = `${API_BASE.replace(/^http/, 'ws')}/ws`

export function api(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

/** The URL the room scans. Always this page's own origin: that is where their phone must land. */
export const JOIN_URL = `${window.location.origin}/`
