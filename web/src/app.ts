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
import { lineText } from './line.js'

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
/** The number OVER and UNDER are about. Projected by the server until the lock, then the contract's. */
let line: number | null = null
let lineFixed = false

function setQuestion(): void {
  $('q').textContent = manche > 0 ? `ROUND ${manche}/2 · ${QUESTION}` : QUESTION
}

/** Any message that carries the line updates it; `fixed` once the contract has computed it. */
function setLine(value: unknown, fixed = false): void {
  if (value === null || value === undefined) return
  const n = Number(value)
  if (!Number.isFinite(n)) return
  line = n
  if (fixed) lineFixed = true
  showLine()
}

function clearLine(): void {
  line = null
  lineFixed = false
  showLine()
}

/**
 * OVER and UNDER mean nothing without the number they are about, so it sits under the question and
 * on both buttons. Until the lock it is the server's projection, which grows with every player who
 * joins; the contract fixes it when bets lock, and says so.
 */
function showLine(): void {
  const known = line !== null && round !== null
  $('lineBox').hidden = !known
  const shown = line === null ? '' : lineText(line)
  $('upCond').textContent = known ? `more than ${shown}` : ''
  $('downCond').textContent = known ? `less than ${shown}` : ''
  $('magentaLine').textContent = known ? `line ${shown}` : 'Line —'
  if (!known) return
  $('lineValue').textContent = shown
  $('lineNote').textContent = lineFixed
    ? 'Fixed for this round · every lit screen counts once every 4 s · pass it and OVER wins on the spot'
    : 'Every lit screen counts once every 4 s for 45 s · the line grows with each new player until the clock starts'
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
  $('resultNet').textContent = ''
  setTick('idle')
  setQuestion()
  setHidden(true)
  clearLine()
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

/**
 * Chips go on a pending pile first. UNDO takes the last one back, CONFIRM signs and sends the pile
 * as one bet. Only a confirmed bet leaves the wallet, and a confirmed bet is final: it is signed,
 * the server has it, and the contract has no way to take it back.
 */
let pendingChips: number[] = []
const pendingTotal = (): number => pendingChips.reduce((sum, chip) => sum + chip, 0)

function clearPending(): void {
  pendingChips = []
  renderPending()
}

function renderPending(): void {
  const total = pendingTotal()
  const open = total > 0 && canBet() && selectedSide !== null
  if (total > 0 && !open) pendingChips = [] // betting closed or no side: the pile is dropped, never sent
  $('pending').classList.toggle('on', open)
  if (!open) return
  const side = selectedSide === 0 ? 'OVER' : 'UNDER'
  $('pendingText').innerHTML = `Not placed yet: <b>${total} AURA</b> on <b>${side}</b>`
  $('confirmBtn').textContent = `CONFIRM ${total}`
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.stakes button')) {
  button.addEventListener('click', () => {
    const room = 1000 - myStake - pendingTotal()
    const raw = button.dataset.stake
    const chip = Math.min(raw === 'all' ? room : Number(raw), room)
    if (chip <= 0) return
    pendingChips.push(chip)
    if (navigator.vibrate) navigator.vibrate(10)
    updateStatus()
  })
}

$('undoBtn').addEventListener('click', () => {
  pendingChips.pop()
  updateStatus()
})

$('confirmBtn').addEventListener('click', () => {
  const total = pendingTotal()
  if (total <= 0) return
  pendingChips = []
  void placeBet(total)
  updateStatus()
})

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
      round?.phase === 'reveal'
        ? 'REVEAL: the clock is paused. Bet again, or keep your bet'
        : round?.phase === 'open'
          ? 'Pick a side'
          : 'Betting closed'
  }

  // each side shows what YOU have on it, so a split bet is readable at a glance
  $('upMine').textContent = myUp > 0 ? `you: ${myUp}` : ''
  $('downMine').textContent = myDown > 0 ? `you: ${myDown}` : ''
  $('sideUp').classList.toggle('mine', myUp > 0)
  $('sideDown').classList.toggle('mine', myDown > 0)

  // chips already on the pending pile are spoken for: only what is left after them can be added
  const room = left - pendingTotal()
  for (const button of document.querySelectorAll<HTMLButtonElement>('.stakes button')) {
    const raw = button.dataset.stake
    const value = raw === 'all' ? room : Number(raw)
    button.disabled = selectedSide === null || value <= 0 || value > room || !canBet()
  }
  renderPending()
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
      const snapRound = msg.round as Record<string, unknown> | null
      applyRound(snapRound)
      if (snapRound) {
        // the snapshot does not say whether the line is final: the contract sets it at the lock
        lineFixed = ['frozen', 'settling', 'resolved'].includes(String(snapRound.phase))
        setLine(snapRound.threshold)
      } else clearLine()
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
      clearPending() // a new manche starts with nothing on the pile
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
      // a new round has a new line: the first tick, a tenth of a second away, brings it
      clearLine()
      // a phone still on the join screen stays there: the round must not skip onboarding
      applyPhase('open')
      updateStatus()
      break
    }
    case 'start': {
      // the line is fixed from here: later arrivals only count from the next round
      setLine(msg.threshold, true)
      break
    }
    case 'threshold': {
      // bets are locked: the contract has computed the line from its registered players
      setLine(msg.threshold, true)
      break
    }
    case 'tick': {
      if (round) round.phase = String(msg.phase ?? round.phase)
      const remaining = Number(msg.remainingMs ?? 0)
      const betting = msg.phase === 'open'
      $('clock').textContent = betting
        ? 'BETS OPEN'
        : msg.phase === 'reveal'
          ? `PAUSED · ${Math.ceil(remaining / 1000)}s LEFT`
          : `${(remaining / 1000).toFixed(1)}s`
      $('clock').classList.toggle('paused', betting || msg.phase === 'reveal')
      $('magentaClock').textContent = `${Math.ceil(remaining / 1000)}s`
      if (msg.hidden === false) showMults(msg)
      else setHidden(true)
      if (msg.count !== undefined) $('magentaCount').textContent = String(msg.count)
      setLine(msg.threshold)
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
      // the room passed the line with time left: OVER is decided, and the clock stopped there
      if (msg.reason === 'line') $('statusText').textContent = 'The room passed the line: OVER wins, settling…'
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
        NEXT_ROUND: 'You joined during this round: you play from the next one',
      }
      $('statusText').textContent = codes[String(msg.code)] ?? String(msg.code)
      setTick('idle')
      break
    }
    case 'resolved': {
      leaveMagenta()
      shownPhase = 'resolved'
      setLine(msg.threshold, true)
      const winner = Number(msg.winner) as 0 | 1
      const onWinner = winner === 0 ? myUp : myDown
      const onLoser = winner === 0 ? myDown : myUp
      const won = onWinner > 0
      const you = msg.you as Record<string, unknown> | undefined
      // a hedged player has won something and lost something: say so rather than pick a side
      const verdict = myStake === 0 ? 'NO BET' : !won ? 'LOST' : onLoser > 0 ? 'SPLIT' : 'WON'
      $('resultBig').textContent = verdict
      $('resultBig').style.color =
        myStake === 0 ? '#888' : verdict === 'WON' ? 'var(--up)' : verdict === 'SPLIT' ? 'var(--gold)' : 'var(--down)'
      const label = winner === 0 ? 'OVER' : 'UNDER'
      showNet(label, winner, onWinner, onLoser, Number(msg.poolUp ?? 0), Number(msg.poolDown ?? 0))
      const outcome = `${label} · ${String(msg.count ?? 0)} light-ups counted, line ${lineText(Number(msg.threshold ?? 0))} · round ${manche}/2`
      // sitting a round out is not losing it: say which of the two it was
      const why = myStake > 0 ? '' : Number(msg.bettors ?? -1) === 0 ? 'Nobody bet this round · ' : 'You sat this round out · '
      $('resultSub').textContent = `${why}${outcome}`
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
      const sent = typeof msg.txHash === 'string'
      $('resultNet').textContent = '' // the last round's line does not belong under the payout
      $('resultBig').textContent = sent ? 'PAID' : 'NO PAYOUT'
      $('resultBig').style.color = 'var(--magenta)'
      // nothing owed means nothing sent: never announce a payment that did not happen
      $('resultSub').textContent = sent
        ? `${String(msg.winners ?? 0)} winners · ${Number(msg.totalMon ?? 0).toFixed(2)} MON sent`
        : 'Nobody made a profit this game, so there was no MON to send'
      $('walletBox').style.display = 'block'
      $('walletKey').textContent = privateKey
      show('vResult')
      break
    }
    default:
      break
  }
}

/**
 * What the round did to this player's AURA, computed exactly as Auramaxx._payRange does: the
 * winning leg times the pot over the winning pool, rounded down, against everything put in on both
 * sides. The score only ever takes a net gain: a switch that lost overall leaves it where it was.
 */
function showNet(label: string, winner: 0 | 1, onWinner: number, onLoser: number, poolUp: number, poolDown: number): void {
  const box = $('resultNet')
  box.className = 'net'
  const staked = onWinner + onLoser
  if (staked === 0) {
    box.textContent = ''
    return
  }
  const total = poolUp + poolDown
  const winningPool = winner === 0 ? poolUp : poolDown
  // nobody backed the winner: the contract hands every stake back
  const back = winningPool === 0 ? staked : Math.floor((onWinner * total) / winningPool)
  const net = back - staked
  box.classList.add(net > 0 ? 'gain' : net < 0 ? 'loss' : 'even')
  if (winningPool === 0) {
    box.textContent = `Nobody backed ${label}: your ${staked} AURA come back`
  } else if (onLoser === 0) {
    box.textContent = `${label} paid ${back} on your ${staked} · +${net} AURA to your score`
  } else if (onWinner === 0) {
    box.textContent = `−${staked} AURA`
  } else {
    // both sides: one leg paid, the other was lost, and only a net gain reaches the score
    box.textContent =
      net > 0
        ? `${label} paid ${back} · you had ${staked} in on both sides · +${net} AURA to your score`
        : `${label} paid ${back} · you had ${staked} in on both sides · ${net} AURA, your score stays put`
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
  // an empty pot has no odds: the regularised 2.00x would be a number that means nothing
  if (Number(msg.poolUp ?? 0) + Number(msg.poolDown ?? 0) === 0) {
    $('upMult').textContent = 'No bets yet'
    $('downMult').textContent = 'No bets yet'
    return
  }
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
