/**
 * The régie. Every button is one POST to the server's /op/* routes, guarded by OP_KEY; the
 * state shown here comes from the same WebSocket the phones use, so the operator sees exactly
 * what the room sees. Reveals pause the round on the server: "Reprendre" is what restarts it.
 */
const $ = (id: string): HTMLElement => document.getElementById(id)!
const AVATARS = ['🦊', '🐸', '👽', '🤖', '🐙', '🦈', '🔥', '💎', '🍄', '👾', '🦍', '🌀']
const PHASES: Record<string, string> = {
  idle: 'EN ATTENTE',
  open: 'PARIS OUVERTS',
  reveal: 'REVEAL — EN PAUSE',
  frozen: 'GELÉ',
  settling: 'RÉSOLUTION…',
  resolved: 'RÉSOLU',
}

const keyInput = $('key') as HTMLInputElement
const fromUrl = new URLSearchParams(location.search).get('k')
keyInput.value = fromUrl ?? localStorage.getItem('auramaxx.opkey') ?? ''
keyInput.addEventListener('change', () => localStorage.setItem('auramaxx.opkey', keyInput.value))

let phase = 'idle'
let kind: 0 | 1 = 0

function log(text: string, error = false): void {
  const line = document.createElement('div')
  if (error) line.className = 'err'
  line.textContent = `${new Date().toLocaleTimeString('fr-FR')}  ${text}`
  $('log').prepend(line)
}

async function op(path: string, query: Record<string, string> = {}): Promise<void> {
  const params = new URLSearchParams({ k: keyInput.value, ...query })
  try {
    const response = await fetch(`/op/${path}?${params.toString()}`, { method: 'POST' })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (response.status === 403) return log('clé régie refusée', true)
    if (!response.ok) return log(`${path} : erreur ${response.status}`, true)
    log(`${path} ok${body.hash ? ` · tx ${String(body.hash).slice(0, 10)}…` : ''}`)
  } catch (error: unknown) {
    log(`${path} : ${String(error)}`, true)
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-op]')) {
  button.addEventListener('click', () => {
    const name = button.dataset.op!
    void op(name, button.dataset.kind ? { kind: button.dataset.kind } : {})
  })
}

$('setCount').addEventListener('click', () => {
  void op('count', { n: ($('count') as HTMLInputElement).value })
})

/** Highlights the one button that makes sense next, and disables the ones that cannot work. */
function refreshButtons(): void {
  const enabled: Record<string, boolean> = {
    open: phase === 'idle' || phase === 'resolved',
    resume: phase === 'reveal',
    freeze: phase === 'open' || phase === 'reveal',
    settle: phase === 'frozen',
    payout: phase === 'resolved',
  }
  const next = phase === 'reveal' ? 'resume' : phase === 'frozen' ? 'settle' : phase === 'resolved' ? 'payout' : phase === 'idle' ? 'open' : ''
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-op]')) {
    const name = button.dataset.op!
    button.disabled = !enabled[name]
    button.classList.toggle('next', name === next)
  }
  $('phase').textContent = PHASES[phase] ?? phase.toUpperCase()
  $('upLabel').textContent = kind === 1 ? 'OVER' : 'UP'
  $('downLabel').textContent = kind === 1 ? 'UNDER' : 'DOWN'
}

function showPools(up: unknown, down: unknown): void {
  if (up === undefined) return
  $('poolUp').textContent = `${String(up)} AURA`
  $('poolDown').textContent = `${String(down)} AURA`
}

function renderBoard(rows: Array<Record<string, unknown>> | undefined): void {
  if (!rows) return
  $('board').innerHTML = rows
    .slice(0, 8)
    .map((row, i) => {
      const name = String(row.name ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
      return `<div><span>${i + 1}. ${AVATARS[Number(row.avatar ?? 0)] ?? ''} ${name}</span><span>${String(row.profit ?? 0)}</span></div>`
    })
    .join('')
}

function handle(msg: Record<string, unknown>): void {
  switch (msg.type) {
    case 'snapshot': {
      $('players').textContent = `${String(msg.players ?? 0)} joueur(s) inscrit(s)`
      const round = msg.round as Record<string, unknown> | null
      if (round) {
        phase = String(round.phase)
        kind = Number(round.kind) as 0 | 1
        showPools(round.poolUp, round.poolDown)
      }
      renderBoard(msg.leaderboard as Array<Record<string, unknown>>)
      break
    }
    case 'joined':
      $('players').textContent = `${String(msg.total ?? 0)} joueur(s) inscrit(s)`
      log(`${String(msg.name)} a rejoint`)
      break
    case 'open':
      kind = Number(msg.kind) as 0 | 1
      phase = 'open'
      $('poolUp').textContent = 'caché'
      $('poolDown').textContent = 'caché'
      log(`round ${String(msg.roundId)} ouvert (${kind === 0 ? 'BTC' : 'magenta'})`)
      break
    case 'tick': {
      phase = String(msg.phase ?? phase)
      const ms = Number(msg.remainingMs ?? 0)
      $('time').textContent = `00:${String(Math.ceil(ms / 1000)).padStart(2, '0')}`
      if (msg.hidden === false) showPools(msg.poolUp, msg.poolDown)
      break
    }
    case 'reveal':
      log(`reveal #${String(msg.n)} — le round est en pause, clique « Reprendre »`)
      showPools(msg.poolUp, msg.poolDown)
      break
    case 'threshold':
      log(`seuil calculé par le contrat : ${String(msg.threshold)}`)
      break
    case 'resolved':
      phase = 'resolved'
      log(`résolu : ${Number(msg.winner) === 0 ? (kind === 1 ? 'OVER' : 'UP') : kind === 1 ? 'UNDER' : 'DOWN'} · ${String(msg.paid ?? 0)} payés`)
      renderBoard(msg.leaderboard as Array<Record<string, unknown>>)
      break
    case 'payout':
      log(`payout MON : ${String(msg.winners)} gagnants · ${Number(msg.totalMon ?? 0).toFixed(2)} MON`)
      break
    default:
      return
  }
  refreshButtons()
}

function connect(): void {
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
  socket.addEventListener('open', () => $('conn').classList.add('on'))
  socket.addEventListener('message', (event) => handle(JSON.parse(String(event.data)) as Record<string, unknown>))
  socket.addEventListener('close', () => {
    $('conn').classList.remove('on')
    setTimeout(connect, 1000)
  })
}

refreshButtons()
connect()
