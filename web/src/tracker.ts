/**
 * The counting logic, with no DOM in it, so it can be tested without a camera.
 *
 * MODE A: each screen is tracked by position. A light appearing where none was counts +1, and
 * that spot is then on cooldown for 4 s — lowering and raising the same phone gains nothing.
 * MODE B: no identity at all; every tick, add however many screens are visible.
 */

export type Mode = 'A' | 'B'

export type TrackedBlob = { x: number; y: number; minX?: number; minY?: number; maxX?: number; maxY?: number }

/**
 * A phone screen rarely arrives as one clean blob: a finger across it, a reflection or a viewing
 * angle splits it into fragments. Merge fragments into one screen before tracking, otherwise each
 * fragment becomes its own source and scores its own point.
 *
 * The distance that counts as "same screen" is RELATIVE to the screens involved, never a fixed
 * number of pixels. Close up, a 40 px screen can be split by a hand with a 15 px hole in it. At
 * the back of the room, two different phones are 3 px wide and 8 px apart — a fixed 12 px rule
 * merged those two into one and the second phone silently stopped counting.
 */
export function mergeBlobs(blobs: readonly TrackedBlob[], ratio: number, minGap = 2): TrackedBlob[] {
  const boxes = blobs.map((b) => ({
    minX: b.minX ?? b.x,
    minY: b.minY ?? b.y,
    maxX: b.maxX ?? b.x,
    maxY: b.maxY ?? b.y,
    x: b.x,
    y: b.y,
    n: 1,
  }))

  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!
        const b = boxes[j]!
        const spanA = Math.max(a.maxX - a.minX, a.maxY - a.minY, 1)
        const spanB = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1)
        const allowed = Math.max(minGap, ratio * Math.min(spanA, spanB))
        const apart =
          a.minX - b.maxX > allowed ||
          b.minX - a.maxX > allowed ||
          a.minY - b.maxY > allowed ||
          b.minY - a.maxY > allowed
        if (apart) continue
        const n = a.n + b.n
        boxes[i] = {
          minX: Math.min(a.minX, b.minX),
          minY: Math.min(a.minY, b.minY),
          maxX: Math.max(a.maxX, b.maxX),
          maxY: Math.max(a.maxY, b.maxY),
          x: (a.x * a.n + b.x * b.n) / n,
          y: (a.y * a.n + b.y * b.n) / n,
          n,
        }
        boxes.splice(j, 1)
        merged = true
        break outer
      }
    }
  }
  return boxes.map((b) => ({ x: b.x, y: b.y, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }))
}

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
/** Velocity is only trustworthy across a few frames; beyond this we assume it stayed put. */
const MAX_PREDICTION_MS = 250
/**
 * Temporal hysteresis: a screen stays "visible" for this long after its blob vanishes. Real masks
 * flicker — a hand shifts, the angle changes, compression eats a frame — and without a grace
 * period every flicker looks like the screen was lowered and raised again.
 */
const VISIBLE_GRACE_MS = 300

/** Width or height of a detected screen, whichever is larger, in grid pixels. */
function blobSpan(blob: TrackedBlob): number {
  const w = (blob.maxX ?? blob.x) - (blob.minX ?? blob.x)
  const h = (blob.maxY ?? blob.y) - (blob.minY ?? blob.y)
  return Math.max(w, h, 1)
}
/** A spot that counted recently keeps a wider claim, so the same screen cannot score twice
 *  just because the tracker lost it for a moment. */
const COOLDOWN_CLAIM = 1.5

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
        // extrapolate only over a few frames: a 2-second gap with leftover velocity would
        // predict a position 100 px away and the screen would never match itself
        const lead = Math.min(dt, MAX_PREDICTION_MS)
        const px = source.x + source.vx * lead
        const py = source.y + source.vy * lead
        // the search radius still grows with the time out of sight
        const cooling = now < source.cooldownUntil
        // a distant 3 px screen must not claim a 10 px neighbourhood
        const scaled = Math.max(3, Math.min(radius, blobSpan(blob) * 2))
        const effective =
          (cooling ? scaled * COOLDOWN_CLAIM : scaled) + Math.min(dt * 0.08, MAX_PREDICTED_DRIFT)
        const dx = px - blob.x
        const dy = py - blob.y
        const d2 = dx * dx + dy * dy
        if (d2 <= effective * effective && d2 < bestDistance) {
          bestDistance = d2
          best = source
        }
      }

      if (!best) {
        // Before inventing a screen, check EVERY source including those already matched this
        // frame: a split screen would otherwise have its second fragment score a second point.
        // Scaled to the screen we are looking at, never a fixed radius. At the back of a room a
        // phone is 3 px across and two of them sit 8 px apart: a fixed 10 px guard would swallow
        // the neighbour, which is exactly what happened on the bench. A fragment of the same
        // screen, by contrast, is always within about one screen-width.
        const span = blobSpan(blob)
        const guard = Math.max(3, Math.min(radius, span * 1.2))
        let near: Source | null = null
        let nearD2 = guard * guard
        for (const source of this.sources) {
          if (now >= source.cooldownUntil) continue // only a spot that just counted holds ground
          const dx = source.x - blob.x
          const dy = source.y - blob.y
          const d2 = dx * dx + dy * dy
          if (d2 <= nearD2) {
            nearD2 = d2
            near = source
          }
        }
        if (near) {
          near.visible = true
          near.lastSeenAt = now
          continue // same screen, already counted
        }

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

    // a source only stops being visible once it has been gone for longer than the grace period
    for (const source of this.sources) {
      if (!matched.has(source)) source.visible = now - source.lastSeenAt <= VISIBLE_GRACE_MS
    }
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
