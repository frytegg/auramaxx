/**
 * Links the camera page to the game. The detector knows nothing about rounds, so this does the
 * two things the round needs from it:
 *   - on 'start' (the régie launches the 45 s clock) the count is reset to zero, so lights seen
 *     while the room was betting, or during the previous manche, never leak into this one;
 *   - while the clock runs, the running total is pushed to the server 4 times a second. The
 *     server only accepts it with the operator key and only during the 45 s window.
 *
 * The key comes from ?k= in the URL, or from the régie's saved key on the same origin.
 */
import { WS_URL } from './api.js'

type Countable = { reset(): void; readonly total: number }

export function linkCamera(detector: Countable, visibleNow: () => number): void {
  const fromUrl = new URLSearchParams(location.search).get('k')
  if (fromUrl) localStorage.setItem('auramaxx.opkey', fromUrl)
  const key = fromUrl ?? localStorage.getItem('auramaxx.opkey') ?? ''

  const badge = document.createElement('div')
  badge.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:50;padding:8px 14px;border-radius:999px;' +
    'font:600 13px ui-monospace,monospace;background:#17101D;border:1px solid #2C1E34;color:#AE9AB2'
  document.body.append(badge)
  const status = (text: string, color = '#AE9AB2'): void => {
    badge.textContent = text
    badge.style.color = color
  }

  if (!key) {
    status('jeu : pas de clé régie (ajoute ?k=… à l’URL)', '#FF4D6A')
    return
  }

  let live = false
  let socket: WebSocket | null = null

  const connect = (): void => {
    socket = new WebSocket(WS_URL)
    socket.addEventListener('open', () => status('jeu : connecté, en attente du chrono', '#35E28C'))
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as { type?: string; phase?: string; round?: { phase?: string } }
      if (msg.type === 'start') {
        detector.reset()
        live = true
      } else if (msg.type === 'tick' || msg.type === 'snapshot') {
        const phase = msg.phase ?? msg.round?.phase
        live = phase === 'live' || phase === 'reveal'
      } else if (msg.type === 'freeze' || msg.type === 'resolved' || msg.type === 'open') {
        live = false
      }
      status(live ? `jeu : EN DIRECT · ${detector.total} envoyé` : 'jeu : connecté, en attente du chrono', live ? '#FF00E5' : '#35E28C')
    })
    socket.addEventListener('close', () => {
      status('jeu : déconnecté, reconnexion…', '#FF4D6A')
      setTimeout(connect, 1000)
    })
  }

  setInterval(() => {
    if (!live || socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'camera', key, total: detector.total, visible: visibleNow() }))
  }, 250)

  connect()
}
