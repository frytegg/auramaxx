/**
 * Links the camera page to the game. The detector knows nothing about rounds, so this does the
 * things the round needs from it:
 *   - on 'start' (the régie launches the 45 s clock) the count is reset to zero, so lights seen
 *     while the room was betting, or during the previous round, never leak into this one;
 *   - while the clock runs, the running total is pushed to the server 4 times a second. The
 *     server only accepts it with the operator key and only during the 45 s window;
 *   - it reports the round's phase and the server's own count back to the page, so the page can
 *     show the number that actually settles the round once the clock has stopped.
 *
 * The key comes from ?k= in the URL, or from the régie's saved key on the same origin. Without it
 * the page still follows the game (reading is public) but sends nothing.
 */
import { WS_URL } from './api.js'

type Countable = { reset(): void; setTotal(value: number): void; readonly total: number }

export type GamePhase = 'idle' | 'open' | 'live' | 'reveal' | 'frozen' | 'settling' | 'resolved'

export type LinkState = {
  /** false: no operator key, so nothing is sent (the server would refuse it anyway) */
  keyed: boolean
  connected: boolean
  phase: GamePhase
  /** the count the server holds, which is what settles the round; null before any round */
  serverCount: number | null
  /** the 45 s window is running: this page's total is being streamed to the game */
  live: boolean
}

const PHASES: readonly GamePhase[] = ['idle', 'open', 'live', 'reveal', 'frozen', 'settling', 'resolved']
const SEND_EVERY_MS = 250

function phaseOf(value: unknown, fallback: GamePhase): GamePhase {
  return PHASES.find((p) => p === value) ?? fallback
}

function optNum(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function linkCamera(detector: Countable, visibleNow: () => number, onChange: (state: LinkState) => void): void {
  const fromUrl = new URLSearchParams(location.search).get('k')
  if (fromUrl) localStorage.setItem('auramaxx.opkey', fromUrl)
  const key = fromUrl ?? localStorage.getItem('auramaxx.opkey') ?? ''

  const state: LinkState = { keyed: key !== '', connected: false, phase: 'idle', serverCount: null, live: false }
  let last = ''
  const emit = (): void => {
    const next = JSON.stringify(state)
    if (next === last) return
    last = next
    onChange({ ...state })
  }

  let socket: WebSocket | null = null
  let attempt = 0

  const handle = (msg: Record<string, unknown>): void => {
    switch (msg.type) {
      case 'start':
        detector.reset()
        state.phase = 'live'
        state.serverCount = 0
        break
      case 'snapshot': {
        const round = (msg.round ?? null) as Record<string, unknown> | null
        state.phase = round ? phaseOf(round.phase, 'idle') : 'idle'
        state.serverCount = round ? optNum(round.count) : null
        // this page was reloaded (or reconnected) mid-round: carry on from the count the server
        // already holds, or the next push would send the room's lights back to zero
        if ((state.phase === 'live' || state.phase === 'reveal') && state.serverCount !== null && state.serverCount > detector.total) {
          detector.setTotal(state.serverCount)
        }
        break
      }
      case 'tick':
        state.phase = phaseOf(msg.phase, state.phase)
        state.serverCount = optNum(msg.count) ?? state.serverCount
        break
      case 'freeze':
        state.phase = 'frozen'
        break
      case 'resolved':
        state.phase = 'resolved'
        state.serverCount = optNum(msg.count) ?? state.serverCount
        break
      case 'open':
        state.phase = 'open'
        state.serverCount = null
        break
      case 'game':
        state.phase = 'idle'
        state.serverCount = null
        break
      default:
        return
    }
    state.live = state.phase === 'live' || state.phase === 'reveal'
    emit()
  }

  const connect = (): void => {
    const ws = new WebSocket(WS_URL)
    socket = ws
    ws.addEventListener('open', () => {
      attempt = 0
      state.connected = true
      emit()
    })
    ws.addEventListener('message', (event) => {
      try {
        handle(JSON.parse(String(event.data)) as Record<string, unknown>)
      } catch (error: unknown) {
        console.error('camera link: unreadable server message', error)
      }
    })
    ws.addEventListener('close', () => {
      state.connected = false
      state.live = false
      emit()
      // jittered exponential backoff, capped at 10 s
      const delay = Math.min(10_000, 500 * 2 ** attempt) * (0.5 + Math.random())
      attempt += 1
      setTimeout(connect, delay)
    })
    ws.addEventListener('error', () => ws.close())
  }

  setInterval(() => {
    if (!state.keyed || !state.live || socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'camera', key, total: detector.total, visible: visibleNow() }))
  }, SEND_EVERY_MS)

  emit()
  connect()
}
