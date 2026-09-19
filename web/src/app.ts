/**
 * The phone. One page, two taps to play: pick a side, pick an amount. Both sides are allowed in
 * the same round — the 1,000 AURA budget is shared between them, so hedging costs real chips.
 *
 * The key lives in localStorage and never leaves the phone: every bet is signed here, the
 * backend only relays it and pays the gas. That is why the operator cannot bet for you.
 * viem's generatePrivateKey uses crypto.getRandomValues, which — unlike crypto.subtle — also
 * works over plain http, so a LAN fallback does not break the wallet.
 */
import { AVATAR_COUNT, avatarHtml, avatarImg, avatarIndex } from './avatars.js'
import { encodePacked, keccak256, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { JOIN_URL, WS_URL, api } from './api.js'

const $ = (id: string): HTMLElement => document.getElementById(id)!
const STORAGE_KEY = 'auramaxx.key'
const STORAGE_NAME = 'auramaxx.profile'
/** The game the saved name was entered for: a reload inside that game gets it back, a new game does not. */
const STORAGE_GAME = 'auramaxx.game'

// --- wallet ------------------------------------------------------------------------------

function loadKey(): Hex {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && /^0x[0-9a-fA-F]{64}$/.test(stored)) return stored as Hex
  const fresh = generatePrivateKey()
  localStorage.setItem(STORAGE_KEY, fresh)
  return fresh
}

const privateKey = loadKey()
const account = privateKeyToAccount(privateKey)

// --- state -------------------------------------------------------------------------------

type Round = {
  id: number
  kind: 0 | 1
  phase: string
  hidden: boolean
  durationMs: number
}

let config: { contract: Address; chainId: number } | null = null
let socket: WebSocket | null = null
let round: Round | null = null
let selectedSide: 0 | 1 | null = null
// what is already committed, per side; `myStake` is the two together and the budget caps that sum
let myUp = 0
let myDown = 0
let myStake = 0
let aura = 1000
let nonce = Number(localStorage.getItem('auramaxx.nonce') ?? '0')
// a phone that played with the old emoji set may remember an index past the pictures we have
let avatar = avatarIndex(Number(localStorage.getItem('auramaxx.avatar') ?? '0'))
let seq = -1
let wakeLock: WakeLockSentinel | null = null
let manche = 0
/** The game the server is running: 0 is the landing page, -1 until the first snapshot says. */
let gameId = -1
/**
 * The game this tab joined, or null while the join screen is up. -1 (joined before the first
 * snapshot) and 0 (joined on the landing page) both mean "the game about to start", which the
 * server carries its landing arrivals into.
 */
let joinedGame: number | null = null
/** The socket this tab has registered its address on; a reconnect needs a fresh join. */
let registeredOn: WebSocket | null = null
/** The name field holds a saved name we put there, not one typed since. */
let namePrefilled = false
const QUESTION = 'HOW MANY WILL LIGHT UP?'

function setQuestion(): void {
  $('q').textContent = manche > 0 ? `ROUND ${manche}/2 · ${QUESTION}` : QUESTION
}


// --- join screen -------------------------------------------------------------------------

const avatarGrid = $('avatars')
// two rows once there are more than four: six faces in one row would be thumbnails on a phone
avatarGrid.style.setProperty('--cols', String(AVATAR_COUNT <= 4 ? AVATAR_COUNT : Math.ceil(AVATAR_COUNT / 2)))
for (let index = 0; index < AVATAR_COUNT; index++) {
  const cell = document.createElement('button')
  cell.type = 'button'
  cell.className = `avatar${index === avatar ? ' sel' : ''}`
  cell.setAttribute('aria-label', `Avatar ${index + 1}`)
  cell.append(avatarImg(index))
  cell.addEventListener('click', () => {
    avatar = index
    localStorage.setItem('auramaxx.avatar', String(index))
    for (const [i, node] of [...avatarGrid.children].entries()) node.classList.toggle('sel', i === index)
  })
  avatarGrid.append(cell)
}

// Empty until the server says which game is running: last game's name must never be on screen,
// let alone sent, before the player has typed this game's. See offerSavedName().
const nameInput = $('name') as HTMLInputElement
nameInput.value = ''
nameInput.addEventListener('input', () => {
  namePrefilled = false
})

$('go').addEventListener('click', () => {
  const name = nameInput.value.trim().slice(0, 12) || 'anon'
  localStorage.setItem(STORAGE_NAME, name)
  localStorage.setItem(STORAGE_GAME, String(gameId))
  joinedGame = gameId
  $('meName').textContent = name
  $('meAvatar').replaceChildren(avatarImg(avatar))
  // if the socket is not up yet this is dropped, and the snapshot that follows the connection
  // registers the player instead (syncGame)
  send({ type: 'join', address: account.address, name, avatar })
  registeredOn = socket?.readyState === WebSocket.OPEN ? socket : null
  show('vGame')
})

/** On the join screen: give a reload its name back, but only inside the game it was typed for. */
function offerSavedName(): void {
  const savedFor = Number(localStorage.getItem(STORAGE_GAME) ?? Number.NaN)
  if (savedFor === gameId && gameId > 0) {
    if (nameInput.value === '') {
      nameInput.value = localStorage.getItem(STORAGE_NAME) ?? ''
      namePrefilled = nameInput.value !== ''
    }
  } else if (namePrefilled) {
    nameInput.value = ''
    namePrefilled = false
  }
}

/**
 * Keeps this tab in step with the server's game. Same game: carry on, and register again on a new
 * socket. A different game (New game, back to the landing page, a server restart): back to the join
 * screen with an empty name, so nothing from the last game reaches the new room.
 */
function syncGame(current: number): void {
  gameId = current
  if (joinedGame === null) {
    offerSavedName()
    return
  }
  const aboutToStart = joinedGame === -1 || joinedGame === 0
  if (joinedGame !== current && !aboutToStart) {
    backToJoin()
    return
  }
  if (joinedGame !== current) {
    joinedGame = current
    localStorage.setItem(STORAGE_GAME, String(current))
  }
  const name = localStorage.getItem(STORAGE_NAME)
  if (name && socket?.readyState === WebSocket.OPEN && registeredOn !== socket) {
    send({ type: 'join', address: account.address, name, avatar })
    registeredOn = socket
  }
}

/** A new game: forget the last one entirely and wait for the player to join again. */
function backToJoin(): void {
  joinedGame = null
  registeredOn = null
  leaveMagenta()
  round = null
  shownPhase = ''
  manche = 0
  myUp = 0
  myDown = 0
  myStake = 0
  aura = 1000
  selectedSide = null
  $('sideUp').classList.remove('sel')
  $('sideDown').classList.remove('sel')
  $('meAura').textContent = '1000'
  $('meName').textContent = '—'
  $('meAvatar').replaceChildren()
  $('walletBox').style.display = 'none'
  $('finalRank').classList.remove('on')
  setTick('idle')
  setQuestion()
  setHidden(true)
  nameInput.value = ''
  namePrefilled = false
  updateStatus()
  show('vJoin')
}

function show(id: string): void {
  for (const view of document.querySelectorAll('.view')) view.classList.remove('on')
  $(id).classList.add('on')
}

// --- betting -----------------------------------------------------------------------------

function betHash(roundId: number, side: 0 | 1, stake: number, n: number): Hex {
  if (!config) throw new Error('no config')
  return keccak256(
    encodePacked(
      ['string', 'uint256', 'address', 'uint256', 'address', 'uint8', 'uint128', 'uint32'],
      ['AURAMAXX', BigInt(config.chainId), config.contract, BigInt(roundId), account.address, side, BigInt(stake), n],
    ),
  )
}

async function placeBet(stake: number): Promise<void> {
  if (!round || selectedSide === null) return
  const remaining = 1000 - myStake
  const amount = Math.min(stake, remaining)
  if (amount <= 0) return

  setTick('pending')
  nonce += 1
  localStorage.setItem('auramaxx.nonce', String(nonce))
  const hash = betHash(round.id, selectedSide, amount, nonce)
  const sig = await account.signMessage({ message: { raw: hash } })
  send({ type: 'bet', side: selectedSide, stake: amount, nonce, sig })
  if (navigator.vibrate) navigator.vibrate(25)
}

function setTick(stateName: 'idle' | 'pending' | 'seen' | 'final'): void {
  const tick = $('tick')
  tick.className = `tick${stateName === 'seen' ? ' seen' : stateName === 'final' ? ' final' : ''}`
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.stakes button')) {
  button.addEventListener('click', () => {
    const raw = button.dataset.stake
    void placeBet(raw === 'all' ? 1000 - myStake : Number(raw))
  })
}

$('sideUp').addEventListener('click', () => selectSide(0))
$('sideDown').addEventListener('click', () => selectSide(1))

function selectSide(side: 0 | 1): void {
  // either side, any time: chips already down never move, but new ones can go anywhere
  selectedSide = side
  $('sideUp').classList.toggle('sel', side === 0)
  $('sideDown').classList.toggle('sel', side === 1)
  updateStatus()
}

function updateStatus(): void {
  const sideName = (s: 0 | 1 | null): string => (s === null ? '' : s === 0 ? 'OVER' : 'UNDER')
  const left = 1000 - myStake

  if (myUp > 0 && myDown > 0) {
    $('statusText').textContent = `OVER ${myUp} · UNDER ${myDown} · ${left} left`
  } else if (myStake > 0) {
    $('statusText').textContent = `${sideName(myUp > 0 ? 0 : 1)} · ${myStake} AURA in · ${left} left`
  } else if (selectedSide !== null) {
    $('statusText').textContent = `${sideName(selectedSide)} — pick your stake`
  } else {
    $('statusText').textContent =
      round?.phase === 'reveal' ? 'REVEAL — 5 s to bet' : round?.phase === 'open' ? 'Pick a side' : 'Betting closed'
  }

  // each side shows what YOU have on it, so a split bet is readable at a glance
  $('upMine').textContent = myUp > 0 ? `you: ${myUp}` : ''
  $('downMine').textContent = myDown > 0 ? `you: ${myDown}` : ''
  $('sideUp').classList.toggle('mine', myUp > 0)
  $('sideDown').classList.toggle('mine', myDown > 0)

  for (const button of document.querySelectorAll<HTMLButtonElement>('.stakes button')) {
    const raw = button.dataset.stake
    const value = raw === 'all' ? left : Number(raw)
    button.disabled = selectedSide === null || value <= 0 || value > left || !canBet()
  }
}

function canBet(): boolean {
  return round !== null && (round.phase === 'open' || round.phase === 'reveal')
}

// --- magenta -----------------------------------------------------------------------------

async function enterMagenta(): Promise<void> {
  show('magenta')
  try {
    wakeLock = await navigator.wakeLock?.request('screen')
  } catch {
    /* the screen may still dim; we say "brightness all the way up" out loud too */
  }
  setTimeout(() => {
    $('magentaHint').style.opacity = '0.25'
  }, 4000)
}

function leaveMagenta(): void {
  void wakeLock?.release().catch(() => undefined)
  wakeLock = null
  $('magentaHint').style.opacity = '1'
}

/**
 * One screen per phase: bets before the clock, magenta while it runs, the betting screen again
 * during each 5 s reveal window, then the result. Driven by the phase on every tick, so a phone
 * that reconnects mid-round lands on the right screen.
 */
let shownPhase = ''
function applyPhase(phase: string): void {
  if ($('vJoin').classList.contains('on') || phase === shownPhase) return
  const previous = shownPhase
  shownPhase = phase
  if (phase === 'live') {
    void enterMagenta()
  } else if (phase === 'reveal') {
    leaveMagenta()
    show('vGame')
    if (navigator.vibrate) navigator.vibrate([20, 60, 20])
  } else if (phase === 'open') {
    show('vGame')
  } else if (phase === 'frozen' || phase === 'settling') {
    if (previous === 'live' || previous === 'reveal') {
      leaveMagenta()
      show('vGame')
      $('statusText').textContent = 'Time is up — settling…'
    }
  }
}

// --- socket ------------------------------------------------------------------------------

function send(message: Record<string, unknown>): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function connect(): void {
  const url = WS_URL
  socket = new WebSocket(url)

  // No join here. A phone that lost the network mid-round registers again, but only once the
  // snapshot the server sends on every connection says it is still the same game (syncGame):
  // firing the saved name blindly is how last game's pseudonym reached a new game's wall.

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as Record<string, unknown>
    if (typeof msg.seq === 'number') {
      // a gap means we missed something: never guess, ask for the whole state
      if (seq >= 0 && msg.seq > seq + 1 && msg.type !== 'snapshot') send({ type: 'resync' })
      seq = msg.seq
    }
    handle(msg)
  })

  socket.addEventListener('close', () => setTimeout(connect, 600 + Math.random() * 900))
  socket.addEventListener('error', () => socket?.close())
}

// iOS Safari suspends sockets in a background tab, and people WILL switch apps to vote
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (socket?.readyState !== WebSocket.OPEN) connect()
    else send({ type: 'resync' })
  }
})

function handle(msg: Record<string, unknown>): void {
  switch (msg.type) {
    case 'snapshot': {
      syncGame(Number(msg.gameId ?? 0))
      manche = Number(msg.manche ?? manche)
      const you = msg.you as Record<string, unknown> | null
      if (you) {
        myUp = Number(you.up ?? 0)
        myDown = Number(you.down ?? 0)
        myStake = myUp + myDown
        aura = Number(you.budget ?? 1000) - myStake
        if (selectedSide === null && myStake > 0) selectedSide = myUp >= myDown ? 0 : 1
        $('meAura').textContent = String(aura)
        $('meName').textContent = String(you.name ?? '')
        $('meAvatar').replaceChildren(avatarImg(Number(you.avatar ?? 0)))
      }
      applyRound(msg.round as Record<string, unknown> | null)
      updateStatus()
      break
    }
    case 'game': {
      // New game or back to the landing page: the server has forgotten the room
      syncGame(Number(msg.gameId ?? 0))
      break
    }
    case 'open': {
      shownPhase = ''
      $('finalRank').classList.remove('on')
      round = {
        id: Number(msg.roundId),
        kind: Number(msg.kind) as 0 | 1,
        phase: 'open',
        hidden: true,
        durationMs: Number(msg.durationMs ?? 30000),
      }
      myUp = 0
      myDown = 0
      myStake = 0
      selectedSide = null
      $('sideUp').classList.remove('sel')
      $('sideDown').classList.remove('sel')
      aura = 1000
      $('meAura').textContent = '1000'
      manche = Number(msg.manche ?? manche + 1)
      setQuestion()
      setHidden(true)
      setTick('idle')
      // a phone still on the join screen stays there: the round must not skip onboarding
      applyPhase('open')
      updateStatus()
      break
    }
    case 'tick': {
      if (round) round.phase = String(msg.phase ?? round.phase)
      const remaining = Number(msg.remainingMs ?? 0)
      const betting = msg.phase === 'open'
      $('clock').textContent = betting ? 'PARIS OUVERTS' : `${(remaining / 1000).toFixed(1)}s`
      $('clock').classList.toggle('paused', betting || msg.phase === 'reveal')
      $('magentaClock').textContent = `${Math.ceil(remaining / 1000)}s`
      if (msg.hidden === false) showMults(msg)
      else setHidden(true)
      if (msg.count !== undefined) $('magentaCount').textContent = String(msg.count)
      if (msg.threshold !== undefined) $('magentaLine').textContent = `seuil ${String(msg.threshold)}`
      applyPhase(String(msg.phase ?? ''))
      updateStatus()
      break
    }
    case 'reveal': {
      setHidden(false)
      showMults(msg)
      applyPhase('reveal')
      break
    }
    case 'freeze': {
      setHidden(false)
      showMults(msg)
      setTick('final')
      applyPhase('frozen')
      break
    }
    case 'bet_ok': {
      myUp = Number(msg.up ?? myUp)
      myDown = Number(msg.down ?? myDown)
      myStake = Number(msg.staked ?? myUp + myDown)
      aura = 1000 - myStake
      $('meAura').textContent = String(aura)
      setTick('seen')
      setTimeout(() => setTick('final'), 500)
      updateStatus()
      break
    }
    case 'error': {
      const codes: Record<string, string> = {
        CLOSED: 'Too late, betting is closed',
        BROKE: 'You have already staked everything',
        BAD_SIG: 'Signature refused',
        NOT_JOINED: 'Reconnect to rejoin',
      }
      $('statusText').textContent = codes[String(msg.code)] ?? String(msg.code)
      setTick('idle')
      break
    }
    case 'resolved': {
      leaveMagenta()
      shownPhase = 'resolved'
      const winner = Number(msg.winner) as 0 | 1
      const onWinner = winner === 0 ? myUp : myDown
      const onLoser = winner === 0 ? myDown : myUp
      const won = onWinner > 0
      const you = msg.you as Record<string, unknown> | undefined
      // a hedged player has won something and lost something: say so rather than pick a side
      const verdict = myStake === 0 ? '—' : !won ? 'LOST' : onLoser > 0 ? 'SPLIT' : 'WON'
      $('resultBig').textContent = verdict
      $('resultBig').style.color =
        myStake === 0 ? '#888' : verdict === 'WON' ? 'var(--up)' : verdict === 'SPLIT' ? 'var(--gold)' : 'var(--down)'
      const label = winner === 0 ? 'OVER' : 'UNDER'
      $('resultSub').textContent = `${label} · ${String(msg.count ?? 0)} screens counted, threshold ${String(msg.threshold ?? 0)} · round ${manche}/2`
      // 'resolved' is a broadcast with no per-player field: read this phone's score off the board
      const board = msg.leaderboard as Array<Record<string, unknown>> | undefined
      const mine = board?.find((row) => String(row.address ?? '').toLowerCase() === account.address.toLowerCase())
      renderBoard(board, Number(mine?.profit ?? you?.profit ?? 0))
      show('vResult')
      break
    }
    case 'final': {
      // the game is over: this player's own avatar and place, the same podium the projector shows
      const rows = (msg.standings ?? []) as Array<{ address?: string }>
      const place = rows.findIndex((r) => String(r.address ?? '').toLowerCase() === account.address.toLowerCase())
      $('finalRank').innerHTML =
        `<div class="face">${avatarHtml(avatar)}</div>` +
        (place >= 0
          ? `<div class="rk">#${place + 1}</div><div class="of">final rank · top ${rows.length}</div>`
          : `<div class="of">not in the top ${rows.length} this time</div>`)
      $('finalRank').classList.add('on')
      break
    }
    case 'payout': {
      $('resultBig').textContent = 'PAID'
      $('resultBig').style.color = 'var(--magenta)'
      $('resultSub').textContent = `${String(msg.winners ?? 0)} winners · ${Number(msg.totalMon ?? 0).toFixed(2)} MON sent`
      $('walletBox').style.display = 'block'
      $('walletKey').textContent = privateKey
      show('vResult')
      break
    }
    default:
      break
  }
}

function applyRound(data: Record<string, unknown> | null): void {
  if (!data) return
  round = {
    id: Number(data.id),
    kind: Number(data.kind) as 0 | 1,
    phase: String(data.phase),
    hidden: data.hidden !== false,
    durationMs: 30000,
  }
  setQuestion()
  setHidden(round.hidden)
}

/**
 * Odds are withheld while betting is open, on purpose: seeing the pools would turn a room of
 * beginners into a queue behind whoever bet first, and the reveal is the moment that pays for it.
 * Before a round exists there is nothing to withhold, so say so rather than claiming a secret.
 */
function setHidden(hidden: boolean): void {
  if (!hidden) return
  const label = round ? 'Hidden' : '—'
  $('upMult').textContent = label
  $('downMult').textContent = label
}

function showMults(msg: Record<string, unknown>): void {
  const up = Number(msg.mult_up_x100 ?? msg.up ?? 0)
  const down = Number(msg.mult_down_x100 ?? msg.down ?? 0)
  $('upMult').textContent = fmtMult(up)
  $('downMult').textContent = fmtMult(down)
}

function fmtMult(x100: number): string {
  if (!x100) return '—'
  return x100 > 9999 ? '>99× your stake' : `${(x100 / 100).toFixed(2)}× your stake`
}

function renderBoard(rows: Array<Record<string, unknown>> | undefined, myProfit: number): void {
  if (!rows) return
  const html = rows
    .slice(0, 5)
    .map((row, i) => {
      const name = String(row.name ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
      return `<div class="row"><span>${i + 1}. <span class="av">${avatarHtml(Number(row.avatar ?? 0))}</span> ${name}</span><span class="aura">${String(row.profit ?? 0)}</span></div>`
    })
    .join('')
  $('resultBoard').innerHTML = `${html}<div class="row" style="margin-top:8px;opacity:.8"><span>you</span><span class="aura">${myProfit}</span></div>`
}

$('copyKey').addEventListener('click', () => {
  void navigator.clipboard?.writeText(privateKey)
  $('copyKey').textContent = 'COPIED'
})


void fetch(api('/api/config'))
  .then((r) => r.json())
  .then((data: { contract: Address; chainId: number }) => {
    config = data
  })
  .catch(() => undefined)

connect()
