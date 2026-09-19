/**
 * Magenta screen detector.
 *
 * The camera sees lights, not people, so a per-person cooldown cannot be enforced directly.
 * MODE A tracks each screen by position: a light that appears where none was counts +1, and that
 * spot then goes on a 4-second cooldown. MODE B samples every 4 seconds and adds however many
 * screens are visible — no identity at all, no exploit, one keystroke away.
 *
 * No model, nothing fetched at runtime: ~0.5 ms per frame of plain canvas 2D.
 * Magenta because nothing in a room is magenta. Never green — French exit signs are green.
 */

import { SourceTracker, mergeBlobs, type Mode } from './tracker.js'

export type { Mode }

export const GRID_W = 320
export const GRID_H = 180

export type Options = {
  /** max gap, in grid pixels, between two fragments of the same screen */
  mergeGap: number
  /** min(R,B) - G above this counts as magenta. Magenta ~229, white 0, skin ~-67, exit sign ~-200 */
  threshold: number
  /** ignore specks: minimum blob area in grid pixels */
  minArea: number
  /** how far a screen may move and still be the same source, in grid pixels */
  radius: number
  /** per-source cooldown, milliseconds */
  cooldownMs: number
  /** MODE B sampling period */
  tickMs: number
  mode: Mode
}

export const DEFAULTS: Options = {
  /** fragments of one screen closer than this are merged before tracking */
  mergeGap: 12,
  threshold: 60,
  minArea: 6,
  radius: 12, // wide shot: ~25 grid px per metre, so 12 is about half a metre. Bigger than
  // that and two neighbours merge into one screen.
  cooldownMs: 4000,
  tickMs: 4000,
  mode: 'A',
}

export type Blob = { x: number; y: number; area: number; minX: number; minY: number; maxX: number; maxY: number }

export type FrameResult = {
  blobs: Blob[]
  /** blobs after merging fragments: this is the number of actual screens */
  screens: number
  visible: number
  total: number
  sources: ReadonlyArray<{ x: number; y: number; cooling: boolean }>
  ms: number
  tickJustFired: boolean
}

export class MagentaDetector {
  options: Options
  private readonly work: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly mask: Uint8Array
  private readonly labels: Int32Array
  private readonly stack: Int32Array
  private reference: Uint8Array | null = null
  private readonly tracker: SourceTracker

  constructor(options: Partial<Options> = {}) {
    this.options = { ...DEFAULTS, ...options }
    this.work = document.createElement('canvas')
    this.work.width = GRID_W
    this.work.height = GRID_H
    const ctx = this.work.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2d context unavailable')
    this.ctx = ctx
    this.mask = new Uint8Array(GRID_W * GRID_H)
    this.labels = new Int32Array(GRID_W * GRID_H)
    this.stack = new Int32Array(GRID_W * GRID_H)
    this.tracker = new SourceTracker({
      radius: this.options.radius,
      cooldownMs: this.options.cooldownMs,
      tickMs: this.options.tickMs,
      mode: this.options.mode,
    })
  }

  /** Called at bet-lock: everything already lit is ignored from here on. */
  captureReference(): void {
    this.reference = new Uint8Array(this.mask)
  }

  clearReference(): void {
    this.reference = null
  }

  reset(): void {
    this.tracker.reset()
    this.reference = null
  }

  get total(): number {
    return this.tracker.total
  }

  /** Manual override: the operator types the number the room agrees on. */
  setTotal(value: number): void {
    this.tracker.setTotal(value)
  }

  process(video: HTMLVideoElement, now = performance.now()): FrameResult {
    const started = performance.now()
    this.ctx.drawImage(video, 0, 0, GRID_W, GRID_H)
    const { data } = this.ctx.getImageData(0, 0, GRID_W, GRID_H)

    const { threshold } = this.options
    const mask = this.mask
    const reference = this.reference
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const r = data[p]!
      const g = data[p + 1]!
      const b = data[p + 2]!
      const score = (r < b ? r : b) - g
      // a pixel already lit at lock time never counts again
      mask[i] = score > threshold && !(reference && reference[i]) ? 1 : 0
    }

    const blobs = this.connectedComponents()
    const result: FrameResult = {
      blobs,
      screens: blobs.length,
      visible: blobs.length,
      total: this.tracker.total,
      sources: [],
      ms: 0,
      tickJustFired: false,
    }

    // keep the tracker in step with the sliders on the calibration bench
    this.tracker.options.radius = this.options.radius
    this.tracker.options.cooldownMs = this.options.cooldownMs
    this.tracker.options.tickMs = this.options.tickMs
    this.tracker.options.mode = this.options.mode

    // one screen often arrives as several fragments: merge before tracking
    const screens = mergeBlobs(blobs, this.options.mergeGap)
    result.screens = screens.length
    result.tickJustFired = this.tracker.ingest(screens, now)
    result.visible = screens.length
    result.total = this.tracker.total
    result.sources = this.tracker.sourceViews
    result.ms = performance.now() - started
    return result
  }

  /** Two-pass flood fill over the binary mask. Allocation-free apart from the blob list. */
  private connectedComponents(): Blob[] {
    const { minArea } = this.options
    const mask = this.mask
    const labels = this.labels
    const stack = this.stack
    labels.fill(0)
    const blobs: Blob[] = []
    let label = 0

    for (let start = 0; start < mask.length; start++) {
      if (mask[start] !== 1 || labels[start] !== 0) continue
      label += 1
      let top = 0
      stack[top++] = start
      labels[start] = label

      let area = 0
      let sumX = 0
      let sumY = 0
      let minX = GRID_W
      let minY = GRID_H
      let maxX = 0
      let maxY = 0

      const visit = (index: number): void => {
        if (mask[index] !== 1 || labels[index] !== 0) return
        labels[index] = label
        stack[top++] = index
      }

      while (top > 0) {
        const index = stack[--top]!
        const x = index % GRID_W
        const y = (index - x) / GRID_W
        area += 1
        sumX += x
        sumY += y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y

        // 4-neighbourhood: enough for solid rectangles, and about twice as fast as 8
        if (x > 0) visit(index - 1)
        if (x < GRID_W - 1) visit(index + 1)
        if (y > 0) visit(index - GRID_W)
        if (y < GRID_H - 1) visit(index + GRID_W)
      }

      if (area >= minArea) {
        blobs.push({ x: sumX / area, y: sumY / area, area, minX, minY, maxX, maxY })
      }
    }
    return blobs
  }

}
