/**
 * Projector screen. Reads from the server over one WebSocket; never touches an RPC, so the
 * number of players does not change how much traffic this page makes.
 */
import { PriceChart, fmt, type Point } from './chart.js'

const $ = (id: string): HTMLElement => document.getElementById(id)!

const chart = new PriceChart($('chart') as HTMLCanvasElement)
let seq = -1
let leaderboardHtml = ''

function connect(): void {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  const socket = new WebSocket(url)

  socket.addEventListener('open', () => {
    $('phase').textContent = 'connected'
  })

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as Record<string, unknown>
    // a gap means we missed state: ask for a full snapshot rather than guessing
    if (typeof msg.seq === 'number') {
      if (seq >= 0 && msg.seq > seq + 1 && msg.type !== 'snapshot') socket.send(JSON.stringify({ type: 'resync' }))
      seq = msg.seq
    }
    handle(msg, socket)
  })

  socket.addEventListener('close', () => {
    $('phase').textContent = 'reconnecting…'
    setTimeout(connect, 800 + Math.random() * 600)
  })
  socket.addEventListener('error', () => socket.close())
}

function handle(msg: Record<string, unknown>, socket: WebSocket): void {
  switch (msg.type) {
    case 'snapshot': {
      const history = (msg.priceHistory ?? []) as Point[]
      chart.seed(history)
      const round = msg.round as Record<string, unknown> | null
      if (round) applyRound(round)
      $('players').textContent = String(msg.players ?? 0)
      renderLeaderboard(msg.leaderboard as Array<Record<string, unknown>>)
      break
    }
    case 'price': {
      chart.push({ t: Number(msg.t), p: Number(msg.p) })
      if (msg.openPrice !== null && msg.openPrice !== undefined) chart.setOpenPrice(Number(msg.openPrice))
      break
    }
    case 'open': {
      chart.setOpenPrice(msg.openPrice === null ? null : Number(msg.openPrice))
      chart.setWindow(Number(msg.durationMs ?? 30_000) + 15_000)
      $('question').textContent =
        Number(msg.kind) === 0 ? 'BITCOIN — UP or DOWN?' : 'HOW MANY OF YOU WILL LIGHT UP?'
      $('phase').textContent = 'open'
      setHidden(true)
      setJoinVisible(false)
      hideFlash()
      break
    }
    case 'tick': {
      const remaining = Number(msg.remainingMs ?? 0)
      $('clock').textContent = (remaining / 1000).toFixed(1)
      $('clock').classList.toggle('paused', msg.phase === 'reveal')
      $('phase').textContent = String(msg.phase ?? '')
      if (msg.hidden === false) showPools(msg)
      break
    }
    case 'reveal': {
      setHidden(false)
      showPools(msg)
      $('phase').textContent = `reveal ${String(msg.n ?? '')}`
      break
    }
    case 'resume':
      setHidden(true)
      break
    case 'freeze': {
      setHidden(false)
      showPools(msg)
      $('phase').textContent = 'frozen'
      break
    }
    case 'resolved': {
      const winner = Number(msg.winner) === 0 ? 'UP' : 'DOWN'
      $('flashBig').textContent = winner
      $('flashBig').style.color = winner === 'UP' ? 'var(--up)' : 'var(--down)'
      const open = msg.openPrice === null ? null : Number(msg.openPrice)
      const close = msg.closePrice === null ? null : Number(msg.closePrice)
      $('flashSub').textContent =
        open !== null && close !== null
          ? `${fmt(open)} → ${fmt(close)} · ${String(msg.paid ?? 0)} paid in 1 transaction`
          : `count ${String(msg.count ?? 0)} vs threshold ${String(msg.threshold ?? 0)} · ${String(msg.paid ?? 0)} paid`
      // never render a hash or a settle time that did not happen
      $('flashHash').textContent = msg.txHash ? `${String(msg.txHash)} · ${String(msg.settleMs ?? '?')} ms` : ''
      $('flash').classList.add('on')
      renderLeaderboard(msg.leaderboard as Array<Record<string, unknown>>)
      setTimeout(hideFlash, 9000)
      break
    }
    case 'joined': {
      $('players').textContent = String(msg.total ?? 0)
      break
    }
    case 'gas': {
      $('gas').textContent = `gas spent ${Number(msg.spent ?? 0).toFixed(4)} MON · relayer ${Number(msg.balance ?? 0).toFixed(2)} MON`
      break
    }
    case 'idle_qr': {
      setJoinVisible(true)
      break
    }
    case 'payout': {
      $('flashBig').textContent = 'PAID'
      $('flashBig').style.color = 'var(--magenta)'
      $('flashSub').textContent = `${String(msg.winners ?? 0)} winners · ${Number(msg.totalMon ?? 0).toFixed(2)} MON · one transaction`
      $('flashHash').textContent = String(msg.txHash ?? '')
      $('flash').classList.add('on')
      break
    }
    default:
      break
  }
  void socket
}

function applyRound(round: Record<string, unknown>): void {
  $('question').textContent =
    Number(round.kind) === 0 ? 'BITCOIN — UP or DOWN?' : 'HOW MANY OF YOU WILL LIGHT UP?'
  $('phase').textContent = String(round.phase ?? '')
  setHidden(round.hidden !== false)
  if (round.hidden === false) showPools(round)
}

function setHidden(hidden: boolean): void {
  $('pools').style.display = hidden ? 'none' : 'grid'
  $('hiddenNote').style.display = hidden ? 'block' : 'none'
}

function showPools(msg: Record<string, unknown>): void {
  const up = Number(msg.poolUp ?? 0)
  const down = Number(msg.poolDown ?? 0)
  $('poolUp').textContent = String(up)
  $('poolDown').textContent = String(down)
  const multUp = Number(msg.mult_up_x100 ?? msg.up ?? 0)
  const multDown = Number(msg.mult_down_x100 ?? msg.down ?? 0)
  $('multUp').textContent = formatMult(multUp)
  $('multDown').textContent = formatMult(multDown)
}

/** An empty side is mathematically enormous; show it as >99x rather than a number that looks broken. */
function formatMult(x100: number): string {
  if (!x100) return '—'
  return x100 > 9999 ? '>99×' : `${(x100 / 100).toFixed(2)}×`
}

function renderLeaderboard(rows: Array<Record<string, unknown>> | undefined): void {
  if (!rows) return
  const html = rows
    .slice(0, 8)
    .map(
      (row) =>
        `<div class="row"><span>${escapeHtml(String(row.name ?? ''))}</span><span class="p">${String(row.profit ?? 0)}</span></div>`,
    )
    .join('')
  if (html !== leaderboardHtml) {
    leaderboardHtml = html
    $('leaderboard').innerHTML = html
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function hideFlash(): void {
  $('flash').classList.remove('on')
}

function loop(): void {
  chart.draw()
  requestAnimationFrame(loop)
}

// the join QR covers the chart until a round opens, then gets out of the way
const qr = $('qr') as HTMLImageElement
qr.src = `/api/qr.svg?url=${encodeURIComponent(location.origin + '/')}`

function setJoinVisible(visible: boolean): void {
  $('join').classList.toggle('off', !visible)
}

void fetch('/api/config')
  .then((r) => r.json())
  .then((config: { contract: string }) => {
    $('contract').textContent = config.contract
  })
  .catch(() => undefined)

connect()
requestAnimationFrame(loop)
