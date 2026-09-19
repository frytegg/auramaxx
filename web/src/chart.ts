/**
 * Live BTC curve for round 1, in the shape a 5-minute up/down market uses: the price to beat as
 * a flat red line, the live price as a moving cursor, and the area between them filled green
 * when you are winning the UP side and red when you are not.
 *
 * Plain canvas 2D, no chart library. It is read from the back of a room, so nothing subtle.
 */

export type Point = { t: number; p: number }

export type ChartTheme = {
  up: string
  down: string
  line: string
  grid: string
  text: string
  font: string
}

export const THEME: ChartTheme = {
  up: '#3bf59b',
  down: '#ff5c7a',
  line: '#ff3b5c',
  grid: 'rgba(255,255,255,.07)',
  text: '#e9e9f2',
  font: 'ui-monospace, "SF Mono", Menlo, monospace',
}

export class PriceChart {
  private points: Point[] = []
  private openPrice: number | null = null
  private windowMs = 45_000
  private pulse = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly theme: ChartTheme = THEME,
  ) {}

  setOpenPrice(price: number | null): void {
    this.openPrice = price
  }

  setWindow(ms: number): void {
    this.windowMs = ms
  }

  seed(points: Point[]): void {
    this.points = [...points]
  }

  push(point: Point): void {
    this.points.push(point)
    const cutoff = point.t - this.windowMs * 1.2
    while (this.points.length > 2 && this.points[0]!.t < cutoff) this.points.shift()
  }

  get latest(): Point | null {
    return this.points.at(-1) ?? null
  }

  /** Signed distance from the line to beat, in dollars. */
  get delta(): number | null {
    const last = this.latest
    return last && this.openPrice !== null ? last.p - this.openPrice : null
  }

  draw(now = Date.now()): void {
    const canvas = this.canvas
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio
      canvas.height = height * ratio
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const padLeft = 12
    const padRight = 132 // room for the price tag on the right
    const padY = 26
    const plotW = width - padLeft - padRight
    const plotH = height - padY * 2

    const from = now - this.windowMs
    const visible = this.points.filter((p) => p.t >= from - 2000)
    if (visible.length === 0) {
      this.drawWaiting(ctx, width, height)
      return
    }

    // The vertical scale always includes the line to beat, with a floor so a flat market does
    // not get amplified into fake drama.
    let min = Math.min(...visible.map((p) => p.p))
    let max = Math.max(...visible.map((p) => p.p))
    if (this.openPrice !== null) {
      min = Math.min(min, this.openPrice)
      max = Math.max(max, this.openPrice)
    }
    const span = Math.max(max - min, (max + min) / 2 * 0.00035, 12)
    const mid = (max + min) / 2
    min = mid - span / 2 - span * 0.25
    max = mid + span / 2 + span * 0.25

    const x = (t: number): number => padLeft + ((t - from) / this.windowMs) * plotW
    const y = (p: number): number => padY + (1 - (p - min) / (max - min)) * plotH

    for (let i = 0; i <= 4; i++) {
      const gy = padY + (plotH * i) / 4
      ctx.strokeStyle = this.theme.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padLeft, gy)
      ctx.lineTo(padLeft + plotW, gy)
      ctx.stroke()
    }

    const last = visible.at(-1)!
    const winning = this.openPrice === null ? true : last.p >= this.openPrice
    const colour = winning ? this.theme.up : this.theme.down
    const baseline = this.openPrice === null ? padY + plotH : y(this.openPrice)

    // filled area between the curve and the line to beat
    ctx.beginPath()
    ctx.moveTo(x(visible[0]!.t), baseline)
    for (const point of visible) ctx.lineTo(x(point.t), y(point.p))
    ctx.lineTo(x(last.t), baseline)
    ctx.closePath()
    const gradient = ctx.createLinearGradient(0, padY, 0, padY + plotH)
    gradient.addColorStop(0, winning ? 'rgba(59,245,155,.30)' : 'rgba(255,92,122,.30)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fill()

    ctx.beginPath()
    for (const [i, point] of visible.entries()) {
      const px = x(point.t)
      const py = y(point.p)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = colour
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.stroke()

    if (this.openPrice !== null) {
      const ly = y(this.openPrice)
      ctx.setLineDash([8, 6])
      ctx.strokeStyle = this.theme.line
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(padLeft, ly)
      ctx.lineTo(padLeft + plotW, ly)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = this.theme.line
      ctx.font = `600 13px ${this.theme.font}`
      ctx.textAlign = 'left'
      ctx.fillText('PRICE TO BEAT', padLeft + 4, ly - 8)
      ctx.font = `700 15px ${this.theme.font}`
      ctx.fillText(fmt(this.openPrice), padLeft + plotW + 10, ly + 5)
    }

    // the live cursor
    const cx = x(last.t)
    const cy = y(last.p)
    this.pulse = (this.pulse + 0.08) % (Math.PI * 2)
    const halo = 10 + Math.sin(this.pulse) * 3
    ctx.beginPath()
    ctx.arc(cx, cy, halo, 0, Math.PI * 2)
    ctx.fillStyle = winning ? 'rgba(59,245,155,.22)' : 'rgba(255,92,122,.22)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.fillStyle = colour
    ctx.fill()

    // the big live price, right of the cursor
    ctx.textAlign = 'left'
    ctx.fillStyle = colour
    ctx.font = `800 30px ${this.theme.font}`
    ctx.fillText(fmt(last.p), padLeft + plotW + 10, cy + 10)

    const delta = this.delta
    if (delta !== null) {
      ctx.font = `700 16px ${this.theme.font}`
      ctx.fillText(`${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`, padLeft + plotW + 10, cy + 32)
    }
  }

  private drawWaiting(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = 'rgba(233,233,242,.4)'
    ctx.font = `600 16px ${this.theme.font}`
    ctx.textAlign = 'center'
    ctx.fillText('waiting for the price feed…', width / 2, height / 2)
    ctx.textAlign = 'left'
  }
}

export function fmt(price: number): string {
  return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
