/**
 * The counting logic, with no DOM in it, so it can be tested without a camera.
 *
 * MODE A: each screen is tracked by position. A light appearing where none was counts +1, and
 * that spot is then on cooldown for 4 s — lowering and raising the same phone gains nothing.
 * MODE B: no identity at all; every tick, add however many screens are visible.
 */

export type Mode = 'A' | 'B'

export type TrackedBlob = { x: number; y: number }

export type TrackerOptions = {
  radius: number
  cooldownMs: number
  tickMs: number
  mode: Mode
}

export type SourceView = { x: number; y: number; cooling: boolean; hits: number }

type Source = {
  x: number
  y: number
  lastSeenAt: number
  cooldownUntil: number
  visible: boolean
  hits: number
}

const SOURCE_TTL_MS = 10_000

export class SourceTracker {
  options: TrackerOptions
  private sources: Source[] = []
  private lastTickAt = -1 // -1, not 0: `now` can legitimately be 0 and 0 would disable ticking
  private totalCount = 0

  constructor(options: TrackerOptions) {
    this.options = options
  }

  get total(): number {
    return this.totalCount
  }

  setTotal(value: number): void {
    this.totalCount = Math.max(0, Math.floor(value))
  }

  reset(): void {
    this.sources = []
    this.totalCount = 0
    this.lastTickAt = -1
  }

  get sourceViews(): SourceView[] {
    const now = this.lastNow
    return this.sources.map((s) => ({ x: s.x, y: s.y, cooling: now < s.cooldownUntil, hits: s.hits }))
  }

  private lastNow = 0

  /** Returns true when a MODE B tick fired on this frame. */
  ingest(blobs: readonly TrackedBlob[], now: number): boolean {
    this.lastNow = now
    if (this.options.mode === 'B') return this.tick(blobs, now)
    this.track(blobs, now)
    return false
  }

  private track(blobs: readonly TrackedBlob[], now: number): void {
    const { radius, cooldownMs } = this.options
    const r2 = radius * radius
    const matched = new Set<Source>()

    for (const blob of blobs) {
      let best: Source | null = null
      let bestDistance = r2
      for (const source of this.sources) {
        if (matched.has(source)) continue
        const dx = source.x - blob.x
        const dy = source.y - blob.y
        const d2 = dx * dx + dy * dy
        if (d2 <= bestDistance) {
          bestDistance = d2
          best = source
        }
      }

      if (!best) {
        // a screen nobody was tracking: count it, then lock that spot
        this.totalCount += 1
        const created: Source = {
          x: blob.x,
          y: blob.y,
          lastSeenAt: now,
          cooldownUntil: now + cooldownMs,
          visible: true,
          hits: 1,
        }
        this.sources.push(created)
        matched.add(created)
        continue
      }

      if (!best.visible && now >= best.cooldownUntil) {
        this.totalCount += 1
        best.cooldownUntil = now + cooldownMs
        best.hits += 1
      }
      // follow a shaking hand, but do not let a source drift across the room
      best.x = best.x * 0.7 + blob.x * 0.3
      best.y = best.y * 0.7 + blob.y * 0.3
      best.visible = true
      best.lastSeenAt = now
      matched.add(best)
    }

    for (const source of this.sources) if (!matched.has(source)) source.visible = false
    this.sources = this.sources.filter((s) => now - s.lastSeenAt < SOURCE_TTL_MS)
  }

  private tick(blobs: readonly TrackedBlob[], now: number): boolean {
    if (this.lastTickAt < 0) {
      this.lastTickAt = now
      return false
    }
    if (now - this.lastTickAt < this.options.tickMs) return false
    this.lastTickAt = now
    this.totalCount += blobs.length
    return true
  }
}
