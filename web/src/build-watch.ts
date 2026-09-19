/**
 * The PC pages (projector, camera, régie) stay open all day while fixes keep being deployed, and a
 * tab never picks up a new script on its own: it keeps running the one it loaded. That is how the
 * projector drew the sixth avatar from a list of three after the other three had shipped.
 *
 * This compares the build the page came from with the one now served (/build.json, written by
 * vite.config.ts) and reloads when they differ — but never while a round is running, so the room
 * never sees the projector or the camera blink mid-round. Every page here already recovers its
 * state from the server's snapshot after a reload, which is what makes reloading safe at all.
 */
import { api } from './api.js'

const CHECK_EVERY_MS = 30_000
/** Once a new build is known, how often to look for the gap between rounds. */
const WAIT_EVERY_MS = 3_000
const ROUND_RUNNING = new Set(['live', 'reveal', 'frozen', 'settling'])

export function reloadOnNewBuild(): void {
  // the dev server reloads pages itself, and publishes no build.json
  if (import.meta.env.DEV) return
  let stale = false

  const check = async (): Promise<void> => {
    try {
      if (!stale) {
        const response = await fetch(`${import.meta.env.BASE_URL}build.json`, { cache: 'no-store' })
        if (!response.ok) return
        const served = (await response.json()) as { id?: unknown }
        if (typeof served.id !== 'string' || served.id === __BUILD_ID__) return
        stale = true
      }
      const health = (await (await fetch(api('/health'), { cache: 'no-store' })).json()) as { round?: unknown }
      if (ROUND_RUNNING.has(String(health.round))) return // the next check, once the round is over
      location.reload()
    } catch (error: unknown) {
      // a failed check changes nothing: the page keeps working and the next one tries again
      console.warn('build check failed', error)
    } finally {
      setTimeout(() => void check(), stale ? WAIT_EVERY_MS : CHECK_EVERY_MS)
    }
  }

  setTimeout(() => void check(), CHECK_EVERY_MS)
}
