/**
 * The phone. One page, two taps to play: pick a side, pick an amount.
 *
 * The key lives in localStorage and never leaves the phone: every bet is signed here, the
 * backend only relays it and pays the gas. That is why the operator cannot bet for you.
 * viem's generatePrivateKey uses crypto.getRandomValues, which — unlike crypto.subtle — also
 * works over plain http, so a LAN fallback does not break the wallet.
 */
import { encodePacked, keccak256, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { PriceChart, type Point } from './chart.js'

const $ = (id: string): HTMLElement => document.getElementById(id)!
const AVATARS = ['🦊', '🐸', '👽', '🤖', '🐙', '🦈', '🔥', '💎', '🍄', '👾', '🦍', '🌀']
const STORAGE_KEY = 'auramaxx.key'
const STORAGE_NAME = 'auramaxx.profile'

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
let myStake = 0
let mySide: 0 | 1 | null = null
let aura = 1000
let nonce = Number(localStorage.getItem('auramaxx.nonce') ?? '0')
let avatar = Number(localStorage.getItem('auramaxx.avatar') ?? '0')
let seq = -1
let wakeLock: WakeLockSentinel | null = null

const chart = new PriceChart($('chart') as HTMLCanvasElement)

// --- join screen -------------------------------------------------------------------------

const avatarGrid = $('avatars')
AVATARS.forEach((emoji, index) => {
  const cell = document.createElement('div')
  cell.className = `avatar${index === avatar ? ' sel' : ''}`
  cell.textContent = emoji
  cell.addEventListener('click', () => {
    avatar = index
    localStorage.setItem('auramaxx.avatar', String(index))
    for (const [i, node] of [...avatarGrid.children].entries()) node.classList.toggle('sel', i === index)
  })
  avatarGrid.append(cell)
})

const nameInput = $('name') as HTMLInputElement
nameInput.value = localStorage.getItem(STORAGE_NAME) ?? ''

$('go').addEventListener('click', () => {
  const name = nameInput.value.trim().slice(0, 12) || 'anon'
  localStorage.setItem(STORAGE_NAME, name)
  $('meName').textContent = name
  $('meAvatar').textContent = AVATARS[avatar] ?? '🦊'
  send({ type: 'join', address: account.address, name, avatar })
  show('vGame')
})

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
  if (mySide !== null && mySide !== side) return // add-only, never switch
  selectedSide = side
  $('sideUp').classList.toggle('sel', side === 0)
  $('sideDown').classList.toggle('sel', side === 1)
  updateStatus()
}

function updateStatus(): void {
  const sideName = (s: 0 | 1 | null): string =>
    s === null ? '' : round?.kind === 1 ? (s === 0 ? 'OVER' : 'UNDER') : s === 0 ? 'UP' : 'DOWN'
  if (myStake > 0) {
    $('statusText').textContent = `${sideName(mySide)} · ${myStake} AURA misés · reste ${1000 - myStake}`
  } else if (selectedSide !== null) {
    $('statusText').textContent = `${sideName(selectedSide)} — choisis ta mise`
  } else {
    $('statusText').textContent = 'choisis un camp'
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.stakes button')) {
    const raw = button.dataset.stake
    const value = raw === 'all' ? 1000 - myStake : Number(raw)
    button.disabled = selectedSide === null || value <= 0 || value > 1000 - myStake || !canBet()
  }
  $('sideUp').classList.toggle('locked', mySide === 1)
  $('sideDown').classList.toggle('locked', mySide === 0)
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
    /* the screen may still dim; we say "luminosité à fond" out loud too */
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

// --- socket ------------------------------------------------------------------------------

function send(message: Record<string, unknown>): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function connect(): void {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  socket = new WebSocket(url)

  socket.addEventListener('open', () => {
    const name = localStorage.getItem(STORAGE_NAME)
    if (name) send({ type: 'join', address: account.address, name, avatar })
  })

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
      chart.seed((msg.priceHistory ?? []) as Point[])
      const you = msg.you as Record<string, unknown> | null
      if (you) {
        aura = Number(you.budget ?? 1000) - Number(you.staked ?? 0)
        myStake = Number(you.staked ?? 0)
        mySide = you.side === null || you.side === undefined ? null : (Number(you.side) as 0 | 1)
        if (mySide !== null) selectedSide = mySide
        $('meAura').textContent = String(aura)
        $('meName').textContent = String(you.name ?? '')
        $('meAvatar').textContent = AVATARS[Number(you.avatar ?? 0)] ?? '🦊'
      }
      applyRound(msg.round as Record<string, unknown> | null)
      updateStatus()
      break
    }
    case 'open': {
      round = {
        id: Number(msg.roundId),
        kind: Number(msg.kind) as 0 | 1,
        phase: 'open',
        hidden: true,
        durationMs: Number(msg.durationMs ?? 30000),
      }
      myStake = 0
      mySide = null
      selectedSide = null
      aura = 1000
      $('meAura').textContent = '1000'
      chart.setOpenPrice(msg.openPrice === null ? null : Number(msg.openPrice))
      chart.setWindow(round.durationMs + 15_000)
      $('chartbox').style.display = round.kind === 0 ? 'block' : 'none'
      $('q').textContent = round.kind === 0 ? 'BITCOIN : UP ou DOWN ?' : 'COMBIEN VONT S’ALLUMER ?'
      $('upName').textContent = round.kind === 0 ? 'UP' : 'OVER'
      $('downName').textContent = round.kind === 0 ? 'DOWN' : 'UNDER'
      setHidden(true)
      setTick('idle')
      // a phone still on the join screen stays there: the round must not skip onboarding
      if (!$('vJoin').classList.contains('on')) show('vGame')
      updateStatus()
      break
    }
    case 'price':
      chart.push({ t: Number(msg.t), p: Number(msg.p) })
      if (msg.openPrice !== null && msg.openPrice !== undefined) chart.setOpenPrice(Number(msg.openPrice))
      break
    case 'tick': {
      if (round) round.phase = String(msg.phase ?? round.phase)
      const remaining = Number(msg.remainingMs ?? 0)
      $('clock').textContent = `${(remaining / 1000).toFixed(1)}s`
      $('clock').classList.toggle('paused', msg.phase === 'reveal')
      if (msg.hidden === false) showMults(msg)
      if (round?.kind === 1 && msg.count !== undefined) $('magentaCount').textContent = String(msg.count)
      updateStatus()
      break
    }
    case 'reveal': {
      setHidden(false)
      showMults(msg)
      if (navigator.vibrate) navigator.vibrate([20, 60, 20])
      break
    }
    case 'resume':
      setHidden(true)
      break
    case 'freeze': {
      setHidden(false)
      showMults(msg)
      setTick('final')
      // round 2: the bet is locked, now the room becomes the oracle
      if (round?.kind === 1) void enterMagenta()
      break
    }
    case 'bet_ok': {
      myStake = Number(msg.staked ?? myStake)
      mySide = selectedSide
      aura = 1000 - myStake
      $('meAura').textContent = String(aura)
      setTick('seen')
      setTimeout(() => setTick('final'), 500)
      updateStatus()
      break
    }
    case 'error': {
      const codes: Record<string, string> = {
        CLOSED: 'trop tard, les paris sont fermés',
        NO_SWITCH: 'on ne change pas de camp, on peut seulement ajouter',
        BROKE: 'tu as déjà tout misé',
        BAD_SIG: 'signature refusée',
        NOT_JOINED: 'reconnecte-toi',
      }
      $('statusText').textContent = codes[String(msg.code)] ?? String(msg.code)
      setTick('idle')
      break
    }
    case 'resolved': {
      leaveMagenta()
      const winner = Number(msg.winner) as 0 | 1
      const won = mySide === winner && myStake > 0
      const you = msg.you as Record<string, unknown> | undefined
      $('resultBig').textContent = myStake === 0 ? '—' : won ? 'GAGNÉ' : 'PERDU'
      $('resultBig').style.color = myStake === 0 ? '#888' : won ? 'var(--up)' : 'var(--down)'
      const label = round?.kind === 1 ? (winner === 0 ? 'OVER' : 'UNDER') : winner === 0 ? 'UP' : 'DOWN'
      $('resultSub').textContent =
        round?.kind === 1
          ? `${label} · ${String(msg.count ?? 0)} écrans comptés, seuil ${String(msg.threshold ?? 0)}`
          : `${label} · ${String(msg.paid ?? 0)} payés en une seule transaction`
      renderBoard(msg.leaderboard as Array<Record<string, unknown>>, Number(you?.profit ?? 0))
      show('vResult')
      break
    }
    case 'payout': {
      $('resultBig').textContent = 'PAYÉ'
      $('resultBig').style.color = 'var(--magenta)'
      $('resultSub').textContent = `${String(msg.winners ?? 0)} gagnants · ${Number(msg.totalMon ?? 0).toFixed(2)} MON envoyés`
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
  $('q').textContent = round.kind === 0 ? 'BITCOIN : UP ou DOWN ?' : 'COMBIEN VONT S’ALLUMER ?'
  $('chartbox').style.display = round.kind === 0 ? 'block' : 'none'
  setHidden(round.hidden)
}

function setHidden(hidden: boolean): void {
  if (hidden) {
    $('upMult').textContent = 'caché'
    $('downMult').textContent = 'caché'
  }
}

function showMults(msg: Record<string, unknown>): void {
  const up = Number(msg.mult_up_x100 ?? msg.up ?? 0)
  const down = Number(msg.mult_down_x100 ?? msg.down ?? 0)
  $('upMult').textContent = fmtMult(up)
  $('downMult').textContent = fmtMult(down)
}

function fmtMult(x100: number): string {
  if (!x100) return '—'
  return x100 > 9999 ? '>99× ta mise' : `${(x100 / 100).toFixed(2)}× ta mise`
}

function renderBoard(rows: Array<Record<string, unknown>> | undefined, myProfit: number): void {
  if (!rows) return
  const html = rows
    .slice(0, 5)
    .map((row, i) => {
      const name = String(row.name ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
      return `<div class="row"><span>${i + 1}. ${AVATARS[Number(row.avatar ?? 0)] ?? ''} ${name}</span><span class="aura">${String(row.profit ?? 0)}</span></div>`
    })
    .join('')
  $('resultBoard').innerHTML = `${html}<div class="row" style="margin-top:8px;opacity:.8"><span>toi</span><span class="aura">${myProfit}</span></div>`
}

$('copyKey').addEventListener('click', () => {
  void navigator.clipboard?.writeText(privateKey)
  $('copyKey').textContent = 'COPIÉE'
})

function loop(): void {
  if (round?.kind === 0) chart.draw()
  requestAnimationFrame(loop)
}

void fetch('/api/config')
  .then((r) => r.json())
  .then((data: { contract: Address; chainId: number }) => {
    config = data
  })
  .catch(() => undefined)

connect()
requestAnimationFrame(loop)
