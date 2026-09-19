/**
 * Projector screen. Reads from the server over one WebSocket; never touches an RPC, so the
 * number of players does not change how much traffic this page makes.
 */
import { JOIN_URL, WS_URL, api } from './api.js'
import { mountMascot } from './avatar.js'
import { avatarOf } from './avatars.js'

const $ = (id: string): HTMLElement => document.getElementById(id)!

const QUESTION = 'HOW MANY WILL LIGHT UP?'
const SHOW = 'SHOW YOUR SCREENS!'
/** The round's own words for its phases; anything else falls back to phaseLabel(). */
const PHASES: Record<string, string> = { open: 'Betting', live: 'Live', settling: 'Settling…' }

function setManche(n: number): void {
  $('manche').textContent = n > 0 ? `ROUND ${n}/2` : 'ROUND —/2'
}
let seq = -1
let leaderboardHtml = ''

// --- the three stages: landing page, join QR, live game ----------------------------------

type Stage = 'lobby' | 'join' | 'game'

/**
 * Starting a game is an operator action, so this page needs the régie key the same way the régie
 * does: from ?k= in the URL, remembered afterwards. Without it the button still renders, and says
 * what is missing rather than failing silently.
 */
const opKey = new URLSearchParams(location.search).get('k') ?? localStorage.getItem('auramaxx.opkey') ?? ''
if (opKey) localStorage.setItem('auramaxx.opkey', opKey)

// the projector laptop also runs the camera detector, so the mascot only animates on the
// landing page and gives the CPU back the moment a game starts
const mascot = mountMascot($('mascot'))

/**
 * The page has to render something before the first snapshot arrives, and whatever it picks is a
 * guess. Rather than flash the wrong stage, the lobby stays veiled until the server says where we
 * are — with a timeout, because a veil that never lifts if the socket is down is worse than a
 * flash. Render's free tier can take half a minute to wake up.
 */
function unveil(): void {
  $('lobby').classList.remove('booting')
}
setTimeout(unveil, 2500)

function setStage(stage: Stage): void {
  unveil()
  $('lobby').classList.toggle('off', stage !== 'lobby')
  $('join').classList.toggle('off', stage !== 'join')
  if (stage === 'lobby') mascot.start()
  else mascot.stop()
}

mascot.start()

function note(text: string, error = false): void {
  $('startNote').textContent = text
  $('startNote').classList.toggle('err', error)
}

const startBtn = $('startBtn') as HTMLButtonElement

startBtn.addEventListener('click', () => void startGame())

/** The server opens the lobby; the resulting broadcast is what moves this page on. */
async function startGame(): Promise<void> {
  if (!opKey) return note('Operator key missing — open this page with ?k=…', true)
  startBtn.disabled = true
  const previous = $('startNote').textContent ?? ''
  note('Starting…')
  try {
    const response = await fetch(api(`/op/game?k=${encodeURIComponent(opKey)}`), { method: 'POST' })
    if (response.status === 403) return note('Operator key refused', true)
    if (!response.ok) return note(`Server error ${response.status}`, true)
    note(previous)
  } catch (error: unknown) {
    note(`Could not reach the server: ${String(error)}`, true)
  } finally {
    startBtn.disabled = false
  }
}

/** Phases arrive lowercase from the server; the screen is projected, so give them a capital. */
function phaseLabel(phase: string): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1)
}

function connect(): void {
  const url = WS_URL
  const socket = new WebSocket(url)

  socket.addEventListener('open', () => {
    $('phase').textContent = 'Connected'
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
    $('phase').textContent = 'Reconnecting…'
    setTimeout(connect, 800 + Math.random() * 600)
  })
  socket.addEventListener('error', () => socket.close())
}

function handle(msg: Record<string, unknown>, socket: WebSocket): void {
  switch (msg.type) {
    case 'snapshot': {
      const manche = Number(msg.manche ?? 0)
      setManche(manche)
      const round = msg.round as Record<string, unknown> | null
      if (round) applyRound(round)
      setPlayers(Number(msg.players ?? 0))
      renderRoster(msg.roster as Array<{ name?: unknown; avatar?: unknown }>)
      // a reload must land back on the stage the game is actually in, not on the landing page
      // (betting happens before the clock, so an open round still shows the join QR)
      setStage(Number(msg.gameId ?? 0) === 0 ? 'lobby' : (manche === 0 && !round) || round?.phase === 'open' ? 'join' : 'game')
      renderLeaderboard(msg.leaderboard as Array<Record<string, unknown>>)
      break
    }
    case 'game': {
      setManche(0)
      setPlayers(Number(msg.players ?? 0))
      $('question').textContent = 'Waiting for the round'
      $('liveCount').textContent = '—'
      $('liveThreshold').textContent = '?'
      $('clock').textContent = '—'
      renderRoster(undefined) // a fresh game starts with an empty wall
      // gameId 0 is the régie sending everyone back to the landing page
      setStage(Number(msg.gameId ?? 1) === 0 ? 'lobby' : 'join')
      hideFlash()
      break
    }
    case 'open': {
      setManche(Number(msg.manche ?? 0))
      $('question').textContent = QUESTION
      $('liveCount').textContent = '—'
      $('liveThreshold').textContent = '?'
      $('phase').textContent = 'Betting'
      $('clock').textContent = 'BET'
      setHidden(true)
      setStage('join') // betting happens before the clock: late arrivals can still scan and bet
      hideFlash()
      break
    }
    case 'start': {
      $('question').textContent = SHOW
      $('liveCount').textContent = '0'
      $('liveThreshold').textContent = String(msg.threshold ?? '?')
      setStage('game')
      break
    }
    case 'tick': {
      const remaining = Number(msg.remainingMs ?? 0)
      if (msg.phase !== 'open') $('clock').textContent = (remaining / 1000).toFixed(1)
      $('clock').classList.toggle('paused', msg.phase === 'reveal' || msg.phase === 'open')
      $('phase').textContent = PHASES[String(msg.phase)] ?? phaseLabel(String(msg.phase ?? ''))
      if (msg.hidden === false) showPools(msg)
      else setHidden(true)
      if (msg.count !== undefined) $('liveCount').textContent = String(msg.count)
      if (msg.threshold !== undefined && msg.threshold !== null) $('liveThreshold').textContent = String(msg.threshold)
      if (msg.phase === 'live' || msg.phase === 'reveal') setStage('game')
      break
    }
    case 'threshold':
      $('liveThreshold').textContent = String(msg.threshold ?? '?')
      break
    case 'reveal': {
      setHidden(false)
      showPools(msg)
      $('phase').textContent = `Reveal ${String(msg.n ?? '')} — 5 s to bet`
      $('question').textContent = `REVEAL ${String(msg.n ?? '')} — LAST CHANCE TO BET`
      break
    }
    case 'reveal_end':
      $('question').textContent = SHOW
      break
    case 'freeze': {
      setHidden(false)
      showPools(msg)
      $('phase').textContent = 'Frozen'
      break
    }
    case 'resolved': {
      const winner = Number(msg.winner) === 0 ? 'OVER' : 'UNDER'
      $('flashBig').textContent = winner
      $('flashBig').style.color = winner === 'OVER' ? 'var(--up)' : 'var(--down)'
      $('liveCount').textContent = String(msg.count ?? 0)
      $('flashSub').textContent = `${String(msg.count ?? 0)} screens vs threshold ${String(msg.threshold ?? 0)} · ${String(msg.paid ?? 0)} paid in one transaction`
      // never render a hash or a settle time that did not happen
      $('flashHash').textContent = msg.txHash ? `${String(msg.txHash)} · ${String(msg.settleMs ?? '?')} ms` : ''
      $('flash').classList.add('on')
      renderLeaderboard(msg.leaderboard as Array<Record<string, unknown>>)
      setTimeout(hideFlash, 9000)
      break
    }
    case 'joined': {
      setPlayers(Number(msg.total ?? 0))
      addToRoster(String(msg.name ?? ''), Number(msg.avatar ?? 0))
      break
    }
    case 'gas': {
      $('gas').textContent = `gas spent ${Number(msg.spent ?? 0).toFixed(4)} MON · relayer ${Number(msg.balance ?? 0).toFixed(2)} MON`
      break
    }
    case 'idle_qr': {
      setStage('join')
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
  $('question').textContent = QUESTION
  if (round.threshold !== null && round.threshold !== undefined) $('liveThreshold').textContent = String(round.threshold)
  if (round.count !== undefined) $('liveCount').textContent = String(round.count)
  $('phase').textContent = phaseLabel(String(round.phase ?? ''))
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


// the join QR covers the live count between "Start a game" and the first round
const qr = $('qr') as HTMLImageElement
qr.src = api(`/api/qr.svg?url=${encodeURIComponent(JOIN_URL)}`)

/** Two places show the count: the header all game long, and the join screen while people arrive. */
function setPlayers(total: number): void {
  $('players').textContent = String(total)
  $('joinCount').textContent =
    total === 0 ? 'No players yet' : total === 1 ? '1 player joined' : `${total} players joined`
}

/** The lobby wall. Arrivals are appended one at a time so each name pops in on its own. */
function addToRoster(name: string, avatar: number): void {
  const empty = $('roster').querySelector('.rosterEmpty')
  if (empty) empty.remove()
  const item = document.createElement('div')
  item.className = 'rosterItem'
  const av = document.createElement('span')
  av.className = 'av'
  av.textContent = avatarOf(avatar)
  const label = document.createElement('span')
  label.textContent = name // textContent, never innerHTML: these names come from the room
  item.append(av, label)
  $('roster').append(item)
}

function renderRoster(rows: Array<{ name?: unknown; avatar?: unknown }> | undefined): void {
  $('roster').innerHTML = ''
  if (!rows || rows.length === 0) {
    const hint = document.createElement('div')
    hint.className = 'rosterEmpty'
    hint.textContent = 'Waiting for players…'
    $('roster').append(hint)
    return
  }
  for (const row of rows) addToRoster(String(row.name ?? ''), Number(row.avatar ?? 0))
}

void fetch(api('/api/config'))
  .then((r) => r.json())
  .then((config: { contract: string }) => {
    $('contract').textContent = config.contract
  })
  .catch(() => undefined)

connect()

export {}
