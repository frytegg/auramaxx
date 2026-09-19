/**
 * Projector screen. Reads from the server over one WebSocket; never touches an RPC, so the
 * number of players does not change how much traffic this page makes.
 */
import { JOIN_URL, WS_URL, api } from './api.js'
import { mountMascot } from './avatar.js'
import { avatarHtml, avatarImg } from './avatars.js'
import { reloadOnNewBuild } from './build-watch.js'
import { lineText } from './line.js'

const $ = (id: string): HTMLElement => document.getElementById(id)!

const QUESTION = 'HOW MANY WILL LIGHT UP?'
const SHOW = 'SHOW YOUR SCREENS!'
/** The round's own words for its phases; anything else falls back to phaseLabel(). */
const PHASES: Record<string, string> = { open: 'Betting', live: 'Live', settling: 'Settling…' }

const MANCHES = 2
let manche = 0
let explorer = ''

function setManche(n: number): void {
  manche = n
  $('manche').textContent = n > 0 ? `ROUND ${n}/${MANCHES}` : `ROUND —/${MANCHES}`
}

/**
 * While the clock runs the wall is the camera page: the room, every lit phone boxed, the count and
 * the clock. It stays loaded underneath the rest of the game so it is warm when the clock starts.
 */
function setCamera(on: boolean): void {
  $('cam').classList.toggle('on', on)
}
const CAMERA_PHASES = new Set(['live', 'frozen', 'settling'])
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
      renderRoster(msg.roster as Array<{ address?: unknown; name?: unknown; avatar?: unknown }>)
      // a reload must land back on the stage the game is actually in, not on the landing page
      // (betting happens before the clock, so an open round still shows the join QR)
      setStage(Number(msg.gameId ?? 0) === 0 ? 'lobby' : (manche === 0 && !round) || round?.phase === 'open' ? 'join' : 'game')
      renderLeaderboard(msg.leaderboard as Array<Record<string, unknown>>)
      renderReceipts(msg.receipts)
      setCamera(CAMERA_PHASES.has(String(round?.phase ?? '')))
      // a reload after the last manche lands straight on the podium, between manches on the standings
      if (Array.isArray(msg.final)) showFinal(msg.final as Standing[], 0)
      else if (round?.phase === 'resolved' && manche < MANCHES) showStandings(msg.leaderboard, 0)
      else hideFinal()
      break
    }
    case 'final':
      // let the last manche's OVER/UNDER flash land first, then the podium
      showFinal(msg.standings as Standing[], 7000)
      break
    case 'game': {
      setManche(0)
      setPlayers(Number(msg.players ?? 0))
      $('question').textContent = 'Waiting for the round'
      $('liveCount').textContent = '—'
      $('liveThreshold').textContent = '?'
      $('clock').textContent = '—'
      // a fresh game starts with an empty wall and an empty board (the server only carries in
      // whoever joined while the landing page was up)
      renderRoster(msg.roster as Array<{ address?: unknown; name?: unknown; avatar?: unknown }> | undefined)
      renderLeaderboard((msg.leaderboard as Array<Record<string, unknown>> | undefined) ?? [])
      // gameId 0 is the régie sending everyone back to the landing page
      setStage(Number(msg.gameId ?? 1) === 0 ? 'lobby' : 'join')
      setCamera(false)
      renderReceipts([])
      hideFinal()
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
      setCamera(false)
      hideFinal() // the standings between manches give way to the next one
      hideFlash()
      break
    }
    case 'start': {
      $('question').textContent = SHOW
      $('liveCount').textContent = '0'
      showLine(msg.threshold)
      setStage('game')
      setCamera(true)
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
      showLine(msg.threshold)
      if (msg.phase === 'live' || msg.phase === 'reveal') setStage('game')
      setCamera(CAMERA_PHASES.has(String(msg.phase)))
      break
    }
    case 'threshold':
      showLine(msg.threshold)
      break
    case 'reveal': {
      // the clock pauses here until the régie resumes it: the odds, and betting open again
      setCamera(false)
      setHidden(false)
      showPools(msg)
      $('phase').textContent = `Reveal ${String(msg.n ?? '')} — clock paused`
      $('question').textContent = `REVEAL ${String(msg.n ?? '')} · BETS ARE OPEN AGAIN`
      break
    }
    case 'reveal_end':
      $('question').textContent = SHOW
      setCamera(true)
      break
    case 'freeze': {
      setHidden(false)
      showPools(msg)
      $('phase').textContent = 'Frozen'
      break
    }
    case 'resolved': {
      setCamera(false)
      const winner = Number(msg.winner) === 0 ? 'OVER' : 'UNDER'
      $('flashBig').textContent = winner
      $('flashBig').style.color = winner === 'OVER' ? 'var(--up)' : 'var(--down)'
      $('liveCount').textContent = String(msg.count ?? 0)
      const early = msg.early === true ? ` with ${Math.ceil(Number(msg.remainingMs ?? 0) / 1000)} s to spare` : ''
      const versus = `${String(msg.count ?? 0)} light-ups vs a line of ${lineText(Number(msg.threshold ?? 0))}${early}`
      // nobody bet: the count still lands, but nothing was won or lost, and no one was paid
      $('flashSub').textContent =
        Number(msg.bettors ?? -1) === 0
          ? `${versus} · nobody had bet, so nothing was won or lost`
          : `${versus} · ${String(msg.paid ?? 0)} paid in one transaction`
      // never render a hash or a settle time that did not happen
      setFlashHash(msg.txHash, msg.settleMs === undefined || msg.settleMs === null ? '' : ` · ${String(msg.settleMs)} ms`)
      $('flash').classList.add('on')
      renderLeaderboard(msg.leaderboard as Array<Record<string, unknown>>)
      renderReceipts(msg.receipts)
      // between the two manches, the standings take the wall until the next one opens
      if (manche < MANCHES) showStandings(msg.leaderboard, 9000)
      else setTimeout(hideFlash, 9000)
      break
    }
    case 'joined': {
      setPlayers(Number(msg.total ?? 0))
      upsertRoster(String(msg.address ?? ''), String(msg.name ?? ''), Number(msg.avatar ?? 0))
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
      renderReceipts(msg.receipts)
      if (typeof msg.txHash === 'string') {
        $('flashBig').textContent = 'PAID'
        $('flashBig').style.color = 'var(--magenta)'
        $('flashSub').textContent = `${String(msg.winners ?? 0)} winners · ${Number(msg.totalMon ?? 0).toFixed(2)} MON · one transaction`
      } else {
        // nothing was owed, so nothing was sent: say so, and show no hash
        $('flashBig').textContent = 'NO PAYOUT'
        $('flashBig').style.color = 'var(--magenta)'
        $('flashSub').textContent = 'Nobody made a profit this game, so there was nothing to send'
      }
      setFlashHash(msg.txHash, '')
      $('flash').classList.add('on')
      setTimeout(hideFlash, 8000) // back to the podium, with every transaction of the game under it
      break
    }
    default:
      break
  }
  void socket
}

function applyRound(round: Record<string, unknown>): void {
  $('question').textContent = QUESTION
  showLine(round.threshold)
  if (round.count !== undefined) $('liveCount').textContent = String(round.count)
  $('phase').textContent = phaseLabel(String(round.phase ?? ''))
  setHidden(round.hidden !== false)
  if (round.hidden === false) showPools(round)
}

/** The line as the room reads it: N.5, so 9 is UNDER and 10 is OVER with nothing to argue about. */
function showLine(value: unknown): void {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return
  $('liveThreshold').textContent = lineText(Number(value))
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
  // an empty pot has no odds: the regularised 2.00x would be a number that means nothing
  if (up + down === 0) {
    $('multUp').textContent = 'No bets'
    $('multDown').textContent = 'No bets'
    return
  }
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

// --- the final podium ----------------------------------------------------------------------

type Standing = { name: string; avatar: number; profit: number }
let finalTimer: ReturnType<typeof setTimeout> | null = null

const CROWN =
  '<svg class="crown" width="44" height="31" viewBox="0 0 34 24" aria-hidden="true">' +
  '<path d="M2 20 L6 6 L13 14 L17 3 L21 14 L28 6 L32 20 Z" fill="#FFD166" stroke="#170013" stroke-width="1"></path></svg>'

function fmtAura(n: number): string {
  return `+${Math.max(0, Math.round(n)).toLocaleString('en-US')} AURA`
}

/** The avatar each player picked at signup, on the podium. Names are escaped: the room typed them. */
function podiumCol(rank: 1 | 2 | 3, p: Standing | undefined): string {
  if (!p) return `<div class="pcol r${rank}" style="visibility:hidden"></div>`
  return `
    <div class="pcol r${rank}">
      <div class="ring">${rank === 1 ? CROWN : ''}<div class="face">${avatarHtml(p.avatar)}</div></div>
      <span class="nm">${escapeHtml(p.name)}</span>
      <span class="sc">${fmtAura(p.profit)}</span>
      <div class="block"><span class="rk">${rank}</span></div>
    </div>`
}

const END_OF_GAME = { kicker: 'End of the game', title: 'AURA MAX LEADERBOARD' }

/** Between the two manches: the same board, this game's players, until the next manche opens. */
function showStandings(rows: unknown, delayMs: number): void {
  if (!Array.isArray(rows)) return
  const standings = (rows as Array<Record<string, unknown>>).slice(0, 10).map((row) => ({
    name: String(row.name ?? ''),
    avatar: Number(row.avatar ?? 0),
    profit: Number(row.profit ?? 0),
  }))
  showFinal(standings, delayMs, { kicker: `After round ${manche} of ${MANCHES}`, title: 'STANDINGS' })
}

function showFinal(rows: Standing[] | undefined, delayMs: number, labels = END_OF_GAME): void {
  if (!rows) return
  if (finalTimer) clearTimeout(finalTimer)
  const render = (): void => {
    $('finalKicker').textContent = labels.kicker
    $('finalTitle').textContent = labels.title
    const [first, second, third, ...rest] = rows
    // classic podium order, left to right: 2nd, 1st, 3rd
    $('podium').innerHTML = podiumCol(2, second) + podiumCol(1, first) + podiumCol(3, third)
    $('rest').innerHTML = rest
      .map(
        (p, i) => `
        <div class="rrow">
          <span class="rk">${i + 4}</span>
          <div class="face">${avatarHtml(p.avatar)}</div>
          <span class="nm">${escapeHtml(p.name)}</span>
          <span class="sc">${fmtAura(p.profit)}</span>
        </div>`,
      )
      .join('')
    $('final').classList.add('on')
    hideFlash()
  }
  if (delayMs > 0) finalTimer = setTimeout(render, delayMs)
  else render()
}

function hideFinal(): void {
  if (finalTimer) clearTimeout(finalTimer)
  finalTimer = null
  $('final').classList.remove('on')
}

function hideFlash(): void {
  $('flash').classList.remove('on')
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

/** Opens in a new tab, on the projector: a hash the room can watch being looked up. */
function txLink(hash: string, text: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.textContent = text
  a.target = '_blank'
  a.rel = 'noopener'
  if (explorer) a.href = `${explorer}/tx/${hash}`
  return a
}

function setFlashHash(hash: unknown, suffix: string): void {
  const box = $('flashHash')
  box.replaceChildren()
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return
  box.append(txLink(hash, `${hash} ↗`), document.createTextNode(suffix))
}

/** Every transaction of the game under the podium, each one a link to the explorer. */
function renderReceipts(list: unknown): void {
  const rows = Array.isArray(list)
    ? (list as Array<{ label?: unknown; hash?: unknown }>).filter(
        (r) => typeof r.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(r.hash),
      )
    : []
  const host = $('receiptList')
  host.replaceChildren(
    ...rows.map((r) => {
      const hash = String(r.hash)
      const a = txLink(hash, '')
      const label = document.createElement('span')
      label.textContent = String(r.label ?? '')
      const short = document.createElement('span')
      short.textContent = `${shortHash(hash)} ↗`
      a.append(label, short)
      return a
    }),
  )
  $('receipts').classList.toggle('on', rows.length > 0)
  $('final').classList.toggle('receipted', rows.length > 0)
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

/**
 * The lobby wall, keyed by address. A player who renames sends a second 'joined' for an address
 * already on the wall, so this updates in place instead of hanging a duplicate next to the old one.
 */
const rosterItems = new Map<string, HTMLElement>()

function upsertRoster(address: string, name: string, avatar: number): void {
  const existing = rosterItems.get(address)
  if (existing) {
    existing.querySelector('.av')!.replaceChildren(avatarImg(avatar))
    existing.querySelector('.nm')!.textContent = name
    return
  }
  const empty = $('roster').querySelector('.rosterEmpty')
  if (empty) empty.remove()
  const item = document.createElement('div')
  item.className = 'rosterItem'
  const av = document.createElement('span')
  av.className = 'av'
  av.append(avatarImg(avatar))
  const label = document.createElement('span')
  label.className = 'nm'
  label.textContent = name // textContent, never innerHTML: these names are typed by the room
  item.append(av, label)
  $('roster').append(item)
  rosterItems.set(address, item)
}

function renderRoster(rows: Array<{ address?: unknown; name?: unknown; avatar?: unknown }> | undefined): void {
  $('roster').innerHTML = ''
  rosterItems.clear()
  if (!rows || rows.length === 0) {
    const hint = document.createElement('div')
    hint.className = 'rosterEmpty'
    hint.textContent = 'Waiting for players…'
    $('roster').append(hint)
    return
  }
  for (const row of rows) upsertRoster(String(row.address ?? ''), String(row.name ?? ''), Number(row.avatar ?? 0))
}

void fetch(api('/api/config'))
  .then((response) => response.json() as Promise<{ explorer?: string }>)
  .then((config) => {
    explorer = (config.explorer ?? '').replace(/\/+$/, '')
  })
  .catch((error: unknown) => console.warn('no explorer link: could not load the chain config', error))

connect()
// the projector stays up all day: pick up each deploy, between rounds
reloadOnNewBuild()

export {}
