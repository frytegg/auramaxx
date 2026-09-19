/**
 * The operator console. Every control is one POST to the server's /op/* routes, guarded by OP_KEY;
 * everything shown comes from the same WebSocket the phones use, so the operator sees exactly what
 * the room sees — the pools included, which the server withholds from everyone outside a reveal.
 *
 * Laid out like a prediction market: the round is the market (question, clock, light-up chart,
 * OVER / UNDER), and the controls are the ticket on the right, which only ever offers the next step.
 * Nothing here is drawn from anything but a server message: no number on this page is made up.
 */
import { avatarHtml } from './avatars.js'
import { WS_URL, api } from './api.js'
import { reloadOnNewBuild } from './build-watch.js'

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`#${id} is missing from regie.html`)
  return element as T
}

const MANCHES = 2
/** Mirrors the README: 100 AURA of profit converts to 1 MON. */
const AURA_PER_MON = 100
const KEY_STORE = 'auramaxx.opkey'
const LOG_LIMIT = 200
const STEPS = 7

type Phase = 'idle' | 'open' | 'live' | 'reveal' | 'frozen' | 'settling' | 'resolved'
type Op = 'game' | 'reset' | 'open' | 'start' | 'resume' | 'freeze' | 'settle' | 'payout' | 'count'
type Msg = Record<string, unknown>
type Row = { name: string; avatar: number; profit: number }
type Verdict = {
  winner: 0 | 1
  count: number
  threshold: number | null
  paid: number
  /** 0 when nobody bet: the count still lands, but nothing was won or lost */
  bettors: number | null
  txHash: string | null
  settleMs: number | null
}
type Payout = { winners: number; totalMon: number; txHash: string | null }
type Action = { op: Op | null; label: string; hint: string; tone?: 'pay'; confirm?: string }

const PHASES: readonly Phase[] = ['idle', 'open', 'live', 'reveal', 'frozen', 'settling', 'resolved']
const OP_LABEL: Record<Op, string> = {
  game: 'New game',
  reset: 'Back to landing',
  open: 'Open betting',
  start: 'Start clock',
  resume: 'Resume clock',
  freeze: 'Stop clock',
  settle: 'Settle',
  payout: 'Payout',
  count: 'Send count',
}

const s = {
  connected: false,
  everConnected: false,
  players: 0,
  gameId: 0,
  manche: 0,
  phase: 'idle' as Phase,
  durationMs: 45_000,
  remainingMs: 45_000,
  hidden: true,
  poolUp: null as number | null,
  poolDown: null as number | null,
  multUp: null as number | null,
  multDown: null as number | null,
  bettorsUp: null as number | null,
  bettorsDown: null as number | null,
  count: null as number | null,
  threshold: null as number | null,
  thresholdOnChain: false,
  revealN: 0,
  /** how many players have bet this round, and since the current reveal: never on which side */
  bettors: null as number | null,
  rebet: null as number | null,
  verdict: null as Verdict | null,
  payout: null as Payout | null,
  relayer: null as number | null,
  gasSpent: null as number | null,
  busy: null as Op | null,
  keyState: 'unknown' as 'unknown' | 'accepted' | 'refused',
  leaderboard: [] as Row[],
}
/** [elapsed ms, light-ups] as the ticks arrive. Only what this page saw: never back-filled. */
let points: Array<[number, number]> = []
let explorer = ''
let logCount = 0

const fmt = new Intl.NumberFormat('en-US')

// --- small helpers ---------------------------------------------------------------------------

function num(value: unknown, fallback: number): number {
  const n = Number(value)
  return value === null || value === undefined || !Number.isFinite(n) ? fallback : n
}

function optNum(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function phaseOf(value: unknown): Phase {
  return PHASES.find((p) => p === value) ?? s.phase
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash
}

/** An empty side is mathematically enormous; show it as >99× rather than a number that looks broken. */
function formatMult(x100: number | null): string {
  if (!x100) return '—'
  return x100 > 9999 ? '>99×' : `${(x100 / 100).toFixed(2)}×`
}

function roundLabel(): string {
  return s.manche > 0 ? `Round ${s.manche} of ${MANCHES}` : 'No round yet'
}

// --- the activity log ---------------------------------------------------------------------------

type LogKind = 'info' | 'ok' | 'err'

function log(text: string, kind: LogKind = 'info'): void {
  const row = document.createElement('div')
  row.className = `arow ${kind}`
  const time = document.createElement('time')
  time.textContent = new Date().toLocaleTimeString('en-GB')
  const body = document.createElement('span')
  body.textContent = text
  row.append(time, body)
  const host = $('log')
  host.prepend(row)
  while (host.childElementCount > LOG_LIMIT) host.lastElementChild?.remove()
  logCount += 1
  $('activityCount').textContent = String(logCount)
}

// --- the operator key -----------------------------------------------------------------------------

const keyInput = $<HTMLInputElement>('key')
const keyFromUrl = new URLSearchParams(location.search).get('k')
keyInput.value = keyFromUrl ?? localStorage.getItem(KEY_STORE) ?? ''
if (keyFromUrl) localStorage.setItem(KEY_STORE, keyFromUrl)
keyInput.addEventListener('input', () => {
  localStorage.setItem(KEY_STORE, keyInput.value.trim())
  s.keyState = 'unknown'
  render()
})

// --- operator commands ------------------------------------------------------------------------------

/** One POST, one at a time: a double click must never open two rounds or pay out twice. */
async function op(name: Op, query: Record<string, string> = {}): Promise<boolean> {
  if (s.busy) return false
  const key = keyInput.value.trim()
  if (!key) {
    keyInput.focus()
    log('Enter the operator key first', 'err')
    return false
  }
  s.busy = name
  render()
  const params = new URLSearchParams({ k: key, ...query })
  try {
    const response = await fetch(api(`/op/${name}?${params.toString()}`), { method: 'POST' })
    const body = (await response.json().catch(() => ({}))) as Msg
    if (response.status === 403) {
      s.keyState = 'refused'
      log('Operator key refused', 'err')
      return false
    }
    if (!response.ok) {
      // a 409 is the server refusing a command the game's state does not allow: its reason says why
      const reason = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`
      log(`${OP_LABEL[name]} ${response.status === 409 ? 'refused' : 'failed'} · ${reason}`, 'err')
      return false
    }
    s.keyState = 'accepted'
    const hash = typeof body.hash === 'string' ? ` · tx ${shortHash(body.hash)}` : ''
    log(`${OP_LABEL[name]} ✓${hash}`, 'ok')
    return true
  } catch (error: unknown) {
    log(`${OP_LABEL[name]} failed · ${error instanceof Error ? error.message : String(error)}`, 'err')
    return false
  } finally {
    s.busy = null
    render()
  }
}

function run(name: Op, confirmText?: string, query?: Record<string, string>): void {
  if (confirmText && !window.confirm(confirmText)) return
  void op(name, query)
}

const PAYOUT_CONFIRM =
  'Send real testnet MON to every player with a profit (100 AURA = 1 MON)?\n\nIt runs once: every paid profit goes back to zero.'

/** The single step that makes sense now. The ticket's big button is always this. */
function nextAction(): Action {
  if (!s.connected) return { op: null, label: s.everConnected ? 'Reconnecting…' : 'Connecting…', hint: 'Waiting for the game server.' }
  if (s.payout) return { op: 'game', label: 'Start a new game', hint: 'Clears every player: phones go back to the join screen and the projector shows the join QR.' }
  const seconds = Math.round(s.durationMs / 1000)
  switch (s.phase) {
    case 'idle':
      return {
        op: 'open',
        label: `Open betting · Round ${s.manche + 1}`,
        hint:
          s.gameId === 0
            ? 'This also opens the game: the projector swaps its landing page for the join QR. Phones can bet as soon as it lands.'
            : 'Phones can bet as soon as this lands on-chain. No time limit: start the clock when the room is ready.',
      }
    case 'open': {
      const bettors = s.bettors ?? 0
      return {
        op: 'start',
        label: `Start the clock · ${seconds} s`,
        hint: `${bettors} of ${s.players} ${s.players === 1 ? 'player has' : 'players have'} bet. Starting locks bets and turns every phone magenta; the clock pauses by itself at each reveal.`,
        confirm:
          bettors === 0
            ? 'Nobody has bet yet.\n\nStart the clock anyway? The round will run and settle, but nobody can win or lose anything.'
            : undefined,
      }
    }
    case 'live':
      return { op: null, label: `Round ${s.manche} is running`, hint: liveHint() }
    case 'reveal': {
      const left = Math.max(0, Math.ceil(s.remainingMs / 1000))
      const rebet = s.rebet ?? 0
      return {
        op: 'resume',
        label: `Resume the clock · ${left} s left`,
        hint: `Reveal ${s.revealN || ''}: the clock is paused and bets are open again. ${rebet} ${rebet === 1 ? 'player has' : 'players have'} bet since the pause, ${s.bettors ?? 0} of ${s.players} this round. Resume when the room is ready.`.replace('  ', ' '),
      }
    }
    case 'frozen':
      return {
        op: 'settle',
        label: `Settle round ${s.manche}`,
        hint: 'The clock is stopped. After a full 45 s it settles by itself within seconds: press this only if it does not, or after a manual stop.',
      }
    case 'settling':
      return { op: null, label: 'Settling on-chain…', hint: 'One transaction pays every winner of this round.' }
    case 'resolved':
      return s.manche < MANCHES
        ? { op: 'open', label: `Open betting · Round ${s.manche + 1}`, hint: `Round ${s.manche} is settled. Same room, a fresh 1,000 AURA each.` }
        : { op: 'payout', label: 'Pay winners in MON', tone: 'pay', confirm: PAYOUT_CONFIRM, hint: '100 AURA of profit = 1 MON, every winner in a single transaction.' }
  }
}

/** Where the running round is, computed from the server's own clock. */
function liveHint(): string {
  const elapsed = s.durationMs - s.remainingMs
  const third = s.durationMs / 3
  const secs = (ms: number): number => Math.max(0, Math.ceil(ms / 1000))
  if (elapsed < third) return `Reveal 1 in ${secs(third - elapsed)} s: the clock pauses there, and waits for you to resume it.`
  if (elapsed < 2 * third) return `Reveal 2 in ${secs(2 * third - elapsed)} s: the clock pauses there, and waits for you to resume it.`
  return `Freezes and settles by itself in ${secs(s.remainingMs)} s.`
}

/** 1-7 through the game: open, clock, live for each round, then the payout. 8 = all done. */
function stepIndex(): number {
  if (s.payout) return STEPS + 1
  const base = Math.max(0, s.manche - 1) * 3
  switch (s.phase) {
    case 'idle':
      return 1
    case 'open':
      return base + 2
    case 'live':
    case 'reveal':
    case 'frozen':
    case 'settling':
      return base + 3
    case 'resolved':
      return s.manche < MANCHES ? base + 4 : STEPS
  }
}

// --- server messages ----------------------------------------------------------------------------------

function clearRound(): void {
  s.poolUp = null
  s.poolDown = null
  s.multUp = null
  s.multDown = null
  s.bettorsUp = null
  s.bettorsDown = null
  s.count = null
  s.threshold = null
  s.thresholdOnChain = false
  s.revealN = 0
  s.verdict = null
  points = []
}

function setPools(msg: Msg): void {
  const up = optNum(msg.poolUp)
  const down = optNum(msg.poolDown)
  if (up === null || down === null) return
  s.poolUp = up
  s.poolDown = down
}

function setLeaderboard(value: unknown): void {
  if (!Array.isArray(value)) return
  s.leaderboard = value.map((row: Msg) => ({
    name: String(row.name ?? ''),
    avatar: num(row.avatar, 0),
    profit: num(row.profit, 0),
  }))
}

/** A point per tick while the clock runs, so the chart is exactly the counts the server sent. */
function addPoint(): void {
  if ((s.phase !== 'live' && s.phase !== 'reveal') || s.count === null) return
  const elapsed = s.durationMs - s.remainingMs
  const last = points[points.length - 1]
  if (last && elapsed <= last[0]) {
    last[1] = s.count
    return
  }
  points.push([elapsed, s.count])
}

function handle(msg: Msg): void {
  switch (msg.type) {
    case 'snapshot': {
      s.players = num(msg.players, s.players)
      s.gameId = num(msg.gameId, s.gameId)
      s.manche = num(msg.manche, 0)
      const round = (msg.round ?? null) as Msg | null
      if (round) {
        s.phase = phaseOf(round.phase)
        s.hidden = round.hidden !== false
        s.remainingMs = num(round.remainingMs, s.remainingMs)
        s.count = optNum(round.count)
        s.threshold = optNum(round.threshold)
        s.bettors = optNum(round.bettors)
        s.rebet = optNum(round.rebet)
        s.revealN = s.phase === 'reveal' ? num(round.revealsDone, 0) : 0
        if (s.hidden) {
          s.poolUp = null
          s.poolDown = null
        } else setPools(round)
      } else {
        clearRound()
        s.phase = 'idle'
      }
      setLeaderboard(msg.leaderboard)
      break
    }
    case 'game': {
      s.gameId = num(msg.gameId, 0)
      s.players = num(msg.players, s.players)
      s.manche = 0
      s.phase = 'idle'
      s.payout = null
      clearRound()
      // the server forgets the room on a new game: the board starts from whoever it carried in
      s.leaderboard = []
      setLeaderboard(msg.leaderboard)
      log(
        s.gameId === 0
          ? 'Back to the landing page · players cleared'
          : `New game · players cleared${s.players > 0 ? `, ${s.players} carried in from the landing page` : ''}`,
      )
      break
    }
    case 'joined': {
      s.players = num(msg.total, s.players)
      log(`${String(msg.name ?? 'anon')} joined`)
      break
    }
    case 'open': {
      clearRound()
      s.manche = num(msg.manche, s.manche + 1)
      s.phase = 'open'
      s.hidden = true
      s.payout = null
      s.durationMs = num(msg.durationMs, s.durationMs)
      s.remainingMs = s.durationMs
      log(`Round ${s.manche} of ${MANCHES} · betting open`)
      break
    }
    case 'start': {
      s.phase = 'live'
      s.durationMs = num(msg.durationMs, s.durationMs)
      s.remainingMs = s.durationMs
      s.threshold = optNum(msg.threshold) ?? s.threshold
      s.count = 0
      points = [[0, 0]]
      log(`Clock started · projected line ${s.threshold ?? '?'}`)
      break
    }
    case 'tick': {
      s.phase = phaseOf(msg.phase)
      s.remainingMs = num(msg.remainingMs, s.remainingMs)
      s.hidden = msg.hidden !== false
      if (s.hidden) {
        s.poolUp = null
        s.poolDown = null
        s.multUp = null
        s.multDown = null
      } else {
        setPools(msg)
        s.multUp = optNum(msg.up)
        s.multDown = optNum(msg.down)
      }
      s.count = optNum(msg.count) ?? s.count
      s.threshold = optNum(msg.threshold) ?? s.threshold
      s.bettors = optNum(msg.bettors) ?? s.bettors
      s.rebet = optNum(msg.rebet) ?? s.rebet
      addPoint()
      break
    }
    case 'reveal': {
      s.revealN = num(msg.n, 0)
      s.hidden = false
      setPools(msg)
      s.multUp = optNum(msg.mult_up_x100)
      s.multDown = optNum(msg.mult_down_x100)
      s.bettorsUp = optNum(msg.up_count)
      s.bettorsDown = optNum(msg.down_count)
      s.bettors = optNum(msg.bettors) ?? s.bettors
      s.rebet = 0
      log(`Reveal ${s.revealN} · clock paused, bets open · OVER ${fmt.format(s.poolUp ?? 0)} / UNDER ${fmt.format(s.poolDown ?? 0)} AURA`)
      break
    }
    case 'reveal_end': {
      const rebet = num(msg.rebet, 0)
      log(`Clock resumed after reveal ${num(msg.n, s.revealN)} · ${rebet} ${rebet === 1 ? 'player' : 'players'} bet during the pause`)
      s.revealN = 0
      break
    }
    case 'freeze': {
      s.phase = 'frozen'
      s.hidden = false
      setPools(msg)
      log('Clock stopped · committing bets on-chain')
      break
    }
    case 'threshold': {
      const line = optNum(msg.threshold)
      if (line !== null) {
        s.threshold = line
        s.thresholdOnChain = true
        log(`Line set by the contract: ${line}`)
      }
      break
    }
    case 'resolved': {
      s.phase = 'resolved'
      const winner = num(msg.winner, 1) === 0 ? 0 : 1
      const line = optNum(msg.threshold)
      s.count = optNum(msg.count) ?? s.count
      if (line !== null) {
        s.threshold = line
        s.thresholdOnChain = true
      }
      setPools(msg)
      s.verdict = {
        winner,
        count: s.count ?? 0,
        threshold: line,
        paid: num(msg.paid, 0),
        bettors: optNum(msg.bettors),
        txHash: typeof msg.txHash === 'string' ? msg.txHash : null,
        settleMs: optNum(msg.settleMs),
      }
      setLeaderboard(msg.leaderboard)
      log(
        `Round ${s.manche} settled · ${winner === 0 ? 'OVER' : 'UNDER'} wins · ${s.verdict.count} vs ${line ?? '?'} · ${s.verdict.paid} paid`,
        'ok',
      )
      break
    }
    case 'payout': {
      s.payout = {
        winners: num(msg.winners, 0),
        totalMon: num(msg.totalMon, 0),
        txHash: typeof msg.txHash === 'string' ? msg.txHash : null,
      }
      log(
        s.payout.txHash
          ? `Paid ${s.payout.winners} winners · ${s.payout.totalMon.toFixed(2)} MON`
          : 'No payout · nobody made a profit this game, so no transaction was sent',
        'ok',
      )
      break
    }
    case 'gas': {
      s.relayer = optNum(msg.balance)
      s.gasSpent = optNum(msg.spent)
      break
    }
    default:
      return
  }
  render()
}

// --- drawing ----------------------------------------------------------------------------------------

let queued = false
/** Ticks arrive at 10 Hz; draw at most once per frame. */
function render(): void {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    draw()
  })
}

function draw(): void {
  drawTopBar()
  drawMarket()
  drawOutcomes()
  drawVerdict()
  drawTicket()
  drawChart()
  drawLeaderboard()
}

function drawTopBar(): void {
  $('conn').classList.toggle('on', s.connected)
  $('connText').textContent = s.connected ? 'Live' : s.everConnected ? 'Reconnecting…' : 'Offline'
  $('players').textContent = fmt.format(s.players)
  $('relayer').textContent = s.relayer === null ? '—' : `${s.relayer.toFixed(2)} MON`
  $('relayer').title = s.gasSpent === null ? '' : `Gas spent so far: ${s.gasSpent.toFixed(4)} MON`
  const keybox = $('keybox')
  keybox.classList.toggle('refused', s.keyState === 'refused')
  keybox.classList.toggle('accepted', s.keyState === 'accepted')
  $('keystate').textContent = s.keyState === 'refused' ? 'Refused' : s.keyState === 'accepted' ? 'Accepted' : ''
  const idle = !s.connected || s.busy !== null
  $<HTMLButtonElement>('newGame').disabled = idle
  $<HTMLButtonElement>('resetGame').disabled = idle
}

function statusText(): { text: string; tone: '' | 'go' | 'live' | 'reveal' } {
  if (s.payout) return { text: s.payout.txHash ? 'Winners paid in MON' : 'Nothing to pay', tone: 'go' }
  switch (s.phase) {
    case 'idle':
      return { text: s.gameId === 0 ? 'Projector on the landing page' : 'Lobby · join QR on screen', tone: '' }
    case 'open':
      return { text: 'Betting open', tone: 'go' }
    case 'live':
      return { text: 'Live · bets locked', tone: 'live' }
    case 'reveal':
      return { text: s.revealN ? `Reveal ${s.revealN} · clock paused` : 'Reveal · clock paused', tone: 'reveal' }
    case 'frozen':
      return { text: 'Clock stopped', tone: '' }
    case 'settling':
      return { text: 'Settling on-chain…', tone: '' }
    case 'resolved':
      return { text: s.verdict ? `${s.verdict.winner === 0 ? 'OVER' : 'UNDER'} won` : 'Settled', tone: '' }
  }
}

function drawMarket(): void {
  $('crumbRound').textContent = s.manche > 0 ? roundLabel() : s.gameId === 0 ? 'No game yet' : 'Lobby open'
  const title = $('title')
  if (s.manche === 0) {
    title.textContent = s.gameId === 0 ? 'Open betting to start round 1' : 'The room is scanning in. Open betting when it is ready.'
  } else {
    title.innerHTML = `Will the room light up more than <span class="line">${s.threshold === null ? '…' : fmt.format(s.threshold)}</span> times?`
  }

  // the clock: grey until it runs, magenta for the last ten seconds
  const running = s.phase === 'live' || s.phase === 'reveal'
  const seconds = Math.max(0, Math.ceil((s.phase === 'idle' || s.phase === 'open' ? s.durationMs : s.remainingMs) / 1000))
  $('cdMin').textContent = String(Math.floor(seconds / 60)).padStart(2, '0')
  $('cdSec').textContent = String(seconds % 60).padStart(2, '0')
  const countdown = $('countdown')
  countdown.classList.toggle('running', running)
  countdown.classList.toggle('hot', running && seconds <= 10)

  for (const n of [1, 2]) {
    const chip = $(`chip${n}`)
    // only a round that was actually played and settled counts as done, payout or not
    const done = s.manche > n || (s.manche === n && s.phase === 'resolved')
    const current = s.manche === n && !done
    chip.classList.toggle('done', done)
    chip.classList.toggle('current', current)
    chip.classList.toggle('live', current && running)
  }
  const status = statusText()
  const chip = $('status')
  chip.textContent = status.text
  chip.className = `chip status ${status.tone}`

  // the headline: where the count stands against the line
  const hasRound = s.manche > 0 && s.phase !== 'idle'
  $('tickerCount').textContent =
    hasRound && s.count !== null ? `${fmt.format(s.count)} · line ${s.threshold === null ? '…' : fmt.format(s.threshold)}` : '—'
  const delta = $('delta')
  delta.className = 'delta num'
  delta.textContent = ''
  if (hasRound && s.count !== null && s.threshold !== null && s.phase !== 'open') {
    if (s.count > s.threshold) {
      delta.textContent = `OVER by ${fmt.format(s.count - s.threshold)}`
      delta.classList.add('over')
    } else {
      delta.textContent = `${fmt.format(s.threshold + 1 - s.count)} more for OVER`
      delta.classList.add('under')
    }
  }
  const source = $('lineSrc')
  source.textContent = !hasRound || s.threshold === null ? '' : s.thresholdOnChain ? 'Line set by the contract' : 'Projected line · the contract sets it at the lock'
  source.classList.toggle('chain', s.thresholdOnChain)
}

function drawOutcomes(): void {
  const hasRound = s.manche > 0 && s.phase !== 'idle'
  const known = !s.hidden && s.poolUp !== null && s.poolDown !== null
  const up = s.poolUp ?? 0
  const down = s.poolDown ?? 0
  const total = up + down

  for (const [side, pool, mult, bettors, fallback] of [
    ['over', up, s.multUp, s.bettorsUp, 'More light-ups than the line'],
    ['under', down, s.multDown, s.bettorsDown, 'The line or fewer'],
  ] as const) {
    const row = $(side === 'over' ? 'rowOver' : 'rowUnder')
    row.classList.toggle('locked', hasRound && !known)
    row.classList.toggle('winner', s.verdict !== null && (s.verdict.winner === 0) === (side === 'over'))
    row.classList.toggle('loser', s.verdict !== null && (s.verdict.winner === 0) !== (side === 'over'))
    $(`${side}Prob`).textContent = known && total > 0 ? `${Math.round((100 * pool) / total)}%` : hasRound && !known ? 'Hidden' : '—'
    // an empty pot has no odds: the regularised 2.00x would be a number that means nothing
    $(`${side}Mult`).textContent = !known ? '—' : total === 0 ? 'No bets' : formatMult(mult)
    $(`${side}Pool`).textContent = known ? `${fmt.format(pool)} AURA` : '—'
    $(`${side}Sub`).textContent = bettors !== null && known ? `${fmt.format(bettors)} ${bettors === 1 ? 'player' : 'players'} on it` : fallback
  }
  $('potTotal').textContent = !hasRound ? 'No pot yet' : known ? `Pot ${fmt.format(total)} AURA` : 'Pot hidden'
  const split = $('split')
  split.classList.toggle('hidden', !known || total === 0)
  $('splitOver').style.width = known && total > 0 ? `${(100 * up) / total}%` : '0%'
  $('lockedNote').hidden = !(hasRound && !known)
}

function drawVerdict(): void {
  const box = $('verdict')
  const who = $('verdictWho')
  const facts = $('verdictFacts')
  const tx = $<HTMLAnchorElement>('verdictTx')
  let hash: string | null = null
  if (s.payout && !s.payout.txHash) {
    who.textContent = 'NO PAYOUT'
    who.className = 'who paid'
    facts.textContent = 'Nobody made a profit this game, so no transaction was sent.'
  } else if (s.payout) {
    who.textContent = 'PAID'
    who.className = 'who paid'
    facts.innerHTML = `<b>${fmt.format(s.payout.winners)}</b> winners paid <b>${s.payout.totalMon.toFixed(2)} MON</b> in one transaction`
    hash = s.payout.txHash
  } else if (s.verdict && s.phase === 'resolved') {
    const v = s.verdict
    who.textContent = v.winner === 0 ? 'OVER' : 'UNDER'
    who.className = `who ${v.winner === 0 ? 'over' : 'under'}`
    const settled = v.settleMs === null ? '' : ` · settled in <b>${fmt.format(v.settleMs)} ms</b>`
    const outcome = v.bettors === 0 ? 'nobody had bet: nothing won or lost' : `<b>${fmt.format(v.paid)}</b> paid`
    facts.innerHTML = `<b>${fmt.format(v.count)}</b> light-ups vs a line of <b>${v.threshold === null ? '?' : fmt.format(v.threshold)}</b> · ${outcome}${settled}`
    hash = v.txHash
  } else {
    box.hidden = true
    return
  }
  box.hidden = false
  // never render a hash that did not happen: no hash, no link
  tx.hidden = hash === null
  if (hash) {
    tx.textContent = `${shortHash(hash)} ↗`
    tx.href = explorer ? `${explorer}/tx/${hash}` : '#'
  }
}

function drawTicket(): void {
  const status = statusText()
  $('ticketRound').textContent = roundLabel()
  const phase = $('ticketPhase')
  phase.textContent = status.text
  phase.className = `ph ${status.tone}`

  const step = stepIndex()
  $('segs')
    .querySelectorAll('i')
    .forEach((seg, i) => {
      seg.className = i < step - 1 ? 'done' : i === step - 1 ? 'now' : ''
    })
  $('stepLabel').textContent = step > STEPS ? 'All done' : `Step ${step} of ${STEPS}`

  const action = nextAction()
  const primary = $<HTMLButtonElement>('primary')
  primary.textContent = s.busy !== null && s.busy === action.op ? 'Sending…' : action.label
  primary.disabled = action.op === null || s.busy !== null
  primary.classList.toggle('pay', action.tone === 'pay')
  primary.classList.toggle('waiting', action.op === null)
  $('hint').textContent = action.hint

  const usable: Record<string, boolean> = {
    freeze: s.phase === 'live' || s.phase === 'reveal',
    settle: s.phase === 'frozen',
    payout: s.phase === 'resolved' && s.payout === null,
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-op]')) {
    const name = button.dataset.op ?? ''
    button.disabled = !s.connected || s.busy !== null || !usable[name]
  }
  $<HTMLButtonElement>('sendCount').disabled = !s.connected || s.busy !== null
}

/** A round number of light-ups on top of the chart, so the grid lines land on whole counts. */
function niceTop(value: number): number {
  const raw = value / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step =
    [1, 2, 2.5, 5, 10]
      .map((m) => m * magnitude)
      .filter(Number.isInteger)
      .find((candidate) => candidate >= raw) ?? 10 * magnitude
  return Math.max(1, Math.round(step)) * 4
}

const chartSvgOrNull = document.querySelector<SVGSVGElement>('#chartSvg')
if (!chartSvgOrNull) throw new Error('#chartSvg is missing from regie.html')
const chartSvg: SVGSVGElement = chartSvgOrNull

/** The frame (axes, reveal windows, line) is always drawn; the light-up curve only once the clock runs. */
function drawChart(): void {
  const first = points[0]
  const last = points[points.length - 1]
  $('chartEmpty').hidden = Boolean(first)
  const host = $('chart')
  const width = host.clientWidth
  const height = host.clientHeight
  const left = 0
  const right = 64
  const top = 24
  const bottom = 30
  const plotW = Math.max(10, width - left - right)
  const plotH = Math.max(10, height - top - bottom)
  const duration = s.durationMs
  const peak = points.reduce((max, p) => Math.max(max, p[1]), 0)
  const line = s.threshold
  const yMax = niceTop(Math.max(peak * 1.15, (line ?? 0) * 1.25, 8))
  const x = (t: number): number => left + (Math.min(Math.max(t, 0), duration) / duration) * plotW
  const y = (c: number): number => top + plotH - (Math.min(Math.max(c, 0), yMax) / yMax) * plotH
  const parts: string[] = [
    '<defs><linearGradient id="lightFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#FF2E9E" stop-opacity=".34"/><stop offset="1" stop-color="#FF2E9E" stop-opacity="0"/>' +
      '</linearGradient></defs>',
  ]

  // the two reveals: the clock pauses there until the régie resumes it, so each is a moment on
  // the clock rather than a stretch of it
  for (const n of [1, 2]) {
    const rx = x((n * duration) / 3)
    parts.push(`<line x1="${rx}" x2="${rx}" y1="${top}" y2="${top + plotH}" stroke="rgba(255,181,71,.55)" stroke-width="1.5" stroke-dasharray="3 4"/>`)
    parts.push(`<text class="rv" x="${rx + 6}" y="${top + 14}">Reveal ${n} · pause</text>`)
  }

  const showLine = line !== null && s.manche > 0 && s.phase !== 'idle'
  for (let i = 0; i <= 4; i++) {
    const value = (yMax * i) / 4
    const gy = y(value)
    parts.push(`<line x1="${left}" x2="${left + plotW}" y1="${gy}" y2="${gy}" stroke="#2A2031" stroke-width="1"/>`)
    // the line's own tag sits on this axis; an axis label under it would only read as noise
    if (showLine && line !== null && Math.abs(gy - y(line)) < 16) continue
    parts.push(`<text x="${left + plotW + 12}" y="${gy + 4}">${fmt.format(value)}</text>`)
  }
  for (let i = 0; i <= 3; i++) {
    const t = (duration * i) / 3
    const anchor = i === 0 ? 'start' : i === 3 ? 'end' : 'middle'
    parts.push(`<text x="${x(t)}" y="${top + plotH + 20}" text-anchor="${anchor}">${Math.round(t / 1000)}s</text>`)
  }

  if (first && last) {
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
    parts.push(`<path d="${path}L${x(last[0]).toFixed(1)},${top + plotH}L${x(first[0]).toFixed(1)},${top + plotH}Z" fill="url(#lightFill)"/>`)
    parts.push(`<path d="${path}" fill="none" stroke="#FF2E9E" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`)
  }

  if (showLine && line !== null) {
    const ly = y(line)
    parts.push(`<line x1="${left}" x2="${left + plotW}" y1="${ly}" y2="${ly}" stroke="#F6F1F5" stroke-width="1.5" stroke-dasharray="6 5"/>`)
    parts.push(`<text class="linelbl" x="${left + 4}" y="${ly - 8}">${s.thresholdOnChain ? 'Line' : 'Projected line'}</text>`)
    parts.push(`<rect x="${left + plotW + 4}" y="${ly - 11}" width="${right - 6}" height="22" rx="4" fill="#F6F1F5"/>`)
    parts.push(`<text class="tagtxt" x="${left + plotW + 4 + (right - 6) / 2}" y="${ly + 4.5}" text-anchor="middle">${fmt.format(line)}</text>`)
  }

  if (last) {
    const cx = x(last[0])
    const cy = y(last[1])
    if (s.phase === 'live' || s.phase === 'reveal') parts.push(`<circle class="now" cx="${cx}" cy="${cy}" r="5" fill="#FF2E9E"/>`)
    parts.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="#FF2E9E" stroke="#0B0710" stroke-width="2"/>`)
  }

  chartSvg.innerHTML = parts.join('')
}

function drawLeaderboard(): void {
  const rows = s.leaderboard.slice(0, 10)
  $('board').innerHTML =
    rows.length === 0
      ? '<div class="blank">Nobody has farmed any AURA yet. Profits land here as each round settles.</div>'
      : rows
          .map(
            (row, i) =>
              `<div class="lrow"><span class="rank">${i + 1}</span><span class="av">${avatarHtml(row.avatar)}</span>` +
              `<span class="name">${escapeHtml(row.name)}</span>` +
              `<span class="aura${row.profit > 0 ? '' : ' zero'}">${row.profit > 0 ? '+' : ''}${fmt.format(row.profit)} AURA</span>` +
              `<span class="mon">${(row.profit / AURA_PER_MON).toFixed(2)} MON</span></div>`,
          )
          .join('')
}

// --- controls ------------------------------------------------------------------------------------------

$('primary').addEventListener('click', () => {
  const action = nextAction()
  if (action.op) run(action.op, action.confirm)
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-op]')) {
  button.addEventListener('click', () => {
    const name = button.dataset.op
    if (name === 'freeze') run('freeze')
    else if (name === 'settle') run('settle')
    else if (name === 'payout') run('payout', PAYOUT_CONFIRM)
  })
}

$('newGame').addEventListener('click', () => {
  run(
    'game',
    // it wipes the room, so a lobby full of people deserves the question too, not just a live game
    (s.manche > 0 || s.players > 0) && s.payout === null
      ? `Start a new game?\n\nEvery player is removed (${s.players} now): phones go back to the join screen and everyone joins again. Any round in progress is dropped.`
      : undefined,
  )
})

$('resetGame').addEventListener('click', () => {
  run(
    'reset',
    s.gameId !== 0 ? 'Send the projector back to the landing page?\n\nEvery player is removed and any round in progress is dropped. Phones go back to the join screen.' : undefined,
  )
})

const countInput = $<HTMLInputElement>('countIn')
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-bump]')) {
  button.addEventListener('click', () => {
    const bump = Number(button.dataset.bump ?? 0)
    const current = Math.max(0, Math.floor(Number(countInput.value) || 0))
    countInput.value = String(bump === 0 ? 0 : Math.max(0, current + bump))
  })
}
$('sendCount').addEventListener('click', () => {
  run('count', undefined, { n: String(Math.max(0, Math.floor(Number(countInput.value) || 0))) })
})

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      const on = other === tab
      other.classList.toggle('on', on)
      $(`pane-${other.dataset.tab ?? ''}`).hidden = !on
    }
  })
}

new ResizeObserver(() => render()).observe($('chart'))

// --- connection ----------------------------------------------------------------------------------------

let seq = -1
let attempt = 0

function connect(): void {
  const socket = new WebSocket(WS_URL)
  socket.addEventListener('open', () => {
    attempt = 0
    seq = -1
    log(s.everConnected ? 'Reconnected to the game server' : 'Connected to the game server', 'ok')
    s.connected = true
    s.everConnected = true
    render()
  })
  socket.addEventListener('message', (event) => {
    let msg: Msg
    try {
      msg = JSON.parse(String(event.data)) as Msg
    } catch (error: unknown) {
      log(`Unreadable server message: ${error instanceof Error ? error.message : String(error)}`, 'err')
      return
    }
    // a gap means a missed broadcast: ask for a full snapshot rather than guessing
    if (typeof msg.seq === 'number') {
      if (seq >= 0 && msg.seq > seq + 1 && msg.type !== 'snapshot') socket.send(JSON.stringify({ type: 'resync' }))
      seq = msg.seq
    }
    handle(msg)
  })
  socket.addEventListener('close', () => {
    if (s.connected) log('Lost the game server · reconnecting', 'err')
    s.connected = false
    render()
    // jittered exponential backoff, capped at 10 s
    const delay = Math.min(10_000, 500 * 2 ** attempt) * (0.5 + Math.random())
    attempt += 1
    setTimeout(connect, delay)
  })
  socket.addEventListener('error', () => socket.close())
}

void fetch(api('/api/config'))
  .then((response) => response.json() as Promise<{ contract?: string; explorer?: string }>)
  .then((config) => {
    explorer = (config.explorer ?? '').replace(/\/+$/, '')
    if (config.contract) {
      const link = $<HTMLAnchorElement>('contract')
      link.textContent = `Contract ${shortHash(config.contract)} ↗`
      if (explorer) link.href = `${explorer}/address/${config.contract}`
    }
    render()
  })
  .catch((error: unknown) => log(`Could not load the chain config: ${error instanceof Error ? error.message : String(error)}`, 'err'))

render()
connect()
reloadOnNewBuild()

export {}
