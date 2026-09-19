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
  vx: number
  vy: number
  lastSeenAt: number
  cooldownUntil: number
  visible: boolean
  hits: number
}

const SOURCE_TTL_MS = 10_000
/** How far a source may be predicted to have travelled while it was hidden, in grid pixels. */
const MAX_PREDICTED_DRIFT = 45

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
    this.windowStart = -1
    this.countedThisWindow = 0
    this.maxVisibleThisWindow = 0
  }

  get sourceViews(): SourceView[] {
    const now = this.lastNow
    return this.sources.map((s) => ({ x: s.x, y: s.y, cooling: now < s.cooldownUntil, hits: s.hits }))
  }

  private lastNow = 0
  /** Rate cap state: within one cooldown window the count may not grow by more than the number
   *  of screens actually visible. One phone therefore cannot score more than once per window,
   *  however wildly it is waved about. */
  private windowStart = -1
  private countedThisWindow = 0
  private maxVisibleThisWindow = 0

  /** Returns true when a MODE B tick fired on this frame. */
  ingest(blobs: readonly TrackedBlob[], now: number): boolean {
    this.lastNow = now
    if (this.options.mode === 'B') return this.tick(blobs, now)
    this.track(blobs, now)
    return false
  }

  private track(blobs: readonly TrackedBlob[], now: number): void {
    const { radius, cooldownMs } = this.options
    const matched = new Set<Source>()

    // the rate cap window
    if (this.windowStart < 0 || now - this.windowStart >= cooldownMs) {
      this.windowStart = now
      this.countedThisWindow = 0
      this.maxVisibleThisWindow = 0
    }
    if (blobs.length > this.maxVisibleThisWindow) this.maxVisibleThisWindow = blobs.length
    const allowance = Math.max(this.maxVisibleThisWindow, blobs.length)
    const canCount = (): boolean => this.countedThisWindow < allowance

    for (const blob of blobs) {
      let best: Source | null = null
      let bestDistance = Infinity
      for (const source of this.sources) {
        if (matched.has(source)) continue
        const dt = now - source.lastSeenAt
        // where we think it went while it was out of sight, plus a radius that grows with
        // that time: a phone swung through the air must match itself, not spawn a trail
        const px = source.x + source.vx * dt
        const py = source.y + source.vy * dt
        const effective = radius + Math.min(dt * 0.08, MAX_PREDICTED_DRIFT)
        const dx = px - blob.x
        const dy = py - blob.y
        const d2 = dx * dx + dy * dy
        if (d2 <= effective * effective && d2 < bestDistance) {
          bestDistance = d2
          best = source
        }
      }

      if (!best) {
        const created: Source = {
          x: blob.x,
          y: blob.y,
          vx: 0,
          vy: 0,
          lastSeenAt: now,
          cooldownUntil: now + cooldownMs,
          visible: true,
          hits: 0,
        }
        if (canCount()) {
          this.totalCount += 1
          this.countedThisWindow += 1
          created.hits = 1
        }
        this.sources.push(created)
        matched.add(created)
        continue
      }

      if (!best.visible && now >= best.cooldownUntil && canCount()) {
        this.totalCount += 1
        this.countedThisWindow += 1
        best.cooldownUntil = now + cooldownMs
        best.hits += 1
      }
      const dt = Math.max(now - best.lastSeenAt, 1)
      // velocity estimate, smoothed, so a jerky hand does not throw the prediction
      best.vx = best.vx * 0.6 + ((blob.x - best.x) / dt) * 0.4
      best.vy = best.vy * 0.6 + ((blob.y - best.y) / dt) * 0.4
      best.x = best.x * 0.5 + blob.x * 0.5
      best.y = best.y * 0.5 + blob.y * 0.5
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
