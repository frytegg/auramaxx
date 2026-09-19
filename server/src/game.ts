import { encodePacked, keccak256, recoverMessageAddress, type Address, type Hex } from 'viem'
import { env } from './env.js'
import { log } from './log.js'
import { GAS, blockNumber, contract, gasFor, gasSpent, publicClient, send } from './chain.js'
import { AURAMAXX_ABI } from './abi.js'
import { currentPrice, onPrice, priceHistory, priceScaled } from './price.js'

export const BUDGET = 1000
export const Q1_MS = 30_000
export const Q2_MS = 45_000
/** Two magenta rounds make a game. */
export const MANCHES = 2
/** Mirrors Auramaxx.sol, only to show a projected line before the contract computes the real one. */
const TICKS = 11
const THRESHOLD_PCT = 45

export type Side = 0 | 1
/**
 * A manche: 'open' = bets before the clock (no time limit), 'live' = the 45 s clock runs, bets are
 * locked and the room shows magenta, 'reveal' = at 1/3 and 2/3 the clock PAUSES, the odds are shown
 * and betting reopens, until the régie resumes it (it checks the room has re-bet, or chosen not
 * to); then 'frozen' → 'settling' → 'resolved' on their own when the 45 s are up.
 */
export type Phase = 'idle' | 'open' | 'live' | 'reveal' | 'frozen' | 'settling' | 'resolved'

export type Entry = {
  player: Address
  side: Side
  stake: number
  nonce: number
  sig: Hex
}

export type Player = {
  address: Address
  name: string
  avatar: number
  onChain: boolean
  /** AURA farmed in THIS game: the contract's cumulative profit minus `baseline`. */
  profit: number
  /**
   * The contract's profit for this address when it joined this game. The contract never forgets a
   * player and its profit only resets at the MON payout, so a phone back from an unpaid rehearsal
   * would otherwise start the new game with last game's score. null until first read.
   */
  baseline: number | null
  /** The game they joined. The lobby wall shows this game's room, not everyone ever seen. */
  game: number
}

type RoundState = {
  id: number
  kind: 0 | 1
  phase: Phase
  durationMs: number
  elapsedMs: number
  lastTick: number
  running: boolean
  revealsDone: number
  /** Who has bet since the current reveal paused the clock: what the régie waits on. */
  rebet: Set<Address>
  hidden: boolean
  entries: Entry[]
  /** Per player, both legs. The BUDGET caps `up + down`, so hedging spends the same chips. */
  stake: Map<Address, { up: number; down: number }>
  poolUp: number
  poolDown: number
  threshold: number | null
  count: number
  visible: number
  openPrice: number | null
  closePrice: number | null
  winner: Side | null
  txHash: Hex | null
  settleMs: number | null
  paid: number
}

export const players = new Map<Address, Player>()
let round: RoundState | null = null
let manche = 0
/**
 * The end-of-game podium, frozen when the last manche resolves. It must be a copy: payoutMon()
 * zeroes every profit on chain (paid once), so a podium read live after the MON payout would show
 * everyone at 0 at the exact moment the room is looking at it.
 */
type Standing = { address: Address; name: string; avatar: number; profit: number }
let finalStandings: Standing[] | null = null
/**
 * Every transaction this game sent that the room can open in the explorer: the bets going on
 * chain, each settlement, the MON payout. Real hashes only, straight from the receipts.
 */
type Receipt = { label: string; hash: Hex }
let receipts: Receipt[] = []
/** The one camera page whose count settles this round (see cameraUpdate). */
let cameraSource: { id: number; at: number } | null = null
const CAMERA_HANDOVER_MS = 2_000
/**
 * 0 means no game is open and the projector shows its landing page.
 *
 * `gameSeq` only ever counts up, and `gameId` takes its value. Deriving the id from a counter that
 * goes back to 0 on a reset would hand the next game the id the last one had. It starts at the
 * boot time rather than at 0 for the same reason across a restart (every Render deploy is one): a
 * phone that joined game 1 before a redeploy must never believe it is in the new game 1 after it.
 */
let gameSeq = Date.now()
let gameId = 0
let joinQueue: Player[] = []
/** Players the contract has registered (it counts them all, ever): what the line is computed from. */
let registeredOnChain = 0
const knownOnChain = new Set<Address>()
const listeners = new Set<(event: unknown) => void>()

export function onBroadcast(fn: (event: unknown) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(event: Record<string, unknown>): void {
  for (const fn of listeners) fn(event)
}

// --- the game --------------------------------------------------------------------------

/**
 * A fresh game: drops any round in progress, puts the manche counter back to zero (which is what
 * the projector waits on to show the join QR) and forgets every player, so the room, the lobby
 * wall and the leaderboard all start empty. Everyone joins again with the name they pick now.
 *
 * The one exception is whoever joined while the landing page was up (game 0): they joined for the
 * game that is starting, so they are carried into it.
 *
 * The contract keeps its players regardless — it has no way to forget one — which is why profits
 * are counted from a per-game baseline rather than read raw.
 */
export function newGame(): { gameId: number; players: number } {
  round = null
  manche = 0
  finalStandings = null
  receipts = []
  const fromLanding = gameId === 0
  forgetPlayers((p) => fromLanding && p.game === 0)
  gameSeq += 1
  gameId = gameSeq
  for (const p of players.values()) p.game = gameId
  emit({ type: 'game', gameId, players: players.size, roster: roster(), leaderboard: leaderboard() })
  log.info({ gameId, carried: players.size }, 'new game')
  return { gameId, players: players.size }
}

/**
 * Back to the landing page. `gameId` going to 0 is what the projector waits on, and nothing else
 * sets it back — without this a server restart was the only way to see the landing page again,
 * which is unusable for rehearsing. The room is forgotten here too: the next game starts empty.
 */
export function resetGame(): { gameId: number } {
  round = null
  manche = 0
  finalStandings = null
  receipts = []
  gameId = 0
  forgetPlayers(() => false)
  emit({ type: 'game', gameId, players: 0, roster: [], leaderboard: [] })
  log.info('reset to the landing page')
  return { gameId }
}

/** Drops every player `keep` rejects, with any join still waiting to go on chain. */
function forgetPlayers(keep: (p: Player) => boolean): void {
  for (const [address, p] of players) if (!keep(p)) players.delete(address)
  joinQueue = joinQueue.filter((p) => players.get(p.address) === p)
}

// --- joining ---------------------------------------------------------------------------

/** The game has six picture avatars (AVATAR_COUNT in web/src/avatars.ts); the contract stores the index as a uint8. */
const AVATAR_SLOTS = 6

export function join(address: Address, name: string, avatar: number): Player {
  const clean = name.trim().slice(0, 12) || 'anon'
  // clamp, never trust: a NaN, negative or fractional index would make joinBatch fail to encode,
  // and the failed batch is requeued at the front — one bad phone would block every later join
  const chosen = Number.isInteger(avatar) && avatar >= 0 ? avatar % AVATAR_SLOTS : 0
  const existing = players.get(address)

  if (existing) {
    // A returning address used to be ignored outright, so anyone playing a second game was stuck
    // with their first pseudonym for good. Renaming is allowed; the contract keeps whatever name
    // it was given at joinBatch, so this only changes what the room sees — which is the part
    // people actually look at.
    const returning = existing.game !== gameId
    existing.game = gameId
    if (returning || existing.name !== clean || existing.avatar !== chosen) {
      existing.name = clean
      existing.avatar = chosen
      emit({ type: 'joined', address, name: clean, avatar: chosen, total: roster().length })
    }
    return existing
  }

  const player: Player = { address, name: clean, avatar: chosen, onChain: false, profit: 0, baseline: null, game: gameId }
  players.set(address, player)
  joinQueue.push(player)
  emit({ type: 'joined', address, name: clean, avatar: chosen, total: roster().length })
  return player
}

/** Batched so 40 arrivals cost one transaction, not 40. */
async function flushJoins(): Promise<void> {
  if (joinQueue.length === 0) return
  const batch = joinQueue.slice(0, 40)
  joinQueue = joinQueue.slice(batch.length)
  try {
    const joinArgs = [
      batch.map((p) => p.address),
      batch.map((p) => toBytes32(p.name)),
      batch.map((p) => p.avatar),
    ] as const
    await send('joinBatch', joinArgs, await gasFor('joinBatch', joinArgs, GAS.join(batch.length)))
    for (const p of batch) p.onChain = true
    log.info({ n: batch.length }, 'joins committed')
  } catch (error: unknown) {
    log.error({ err: String(error) }, 'joinBatch failed, requeueing')
    // only the ones still in the room: a player dropped by a new game meanwhile stays dropped
    joinQueue = [...batch.filter((p) => players.get(p.address) === p), ...joinQueue]
  }
  // read the arrivals' starting profit now, well before any round of this game can settle, and
  // the registered count the line is computed from
  try {
    await refreshProfits()
  } catch (error: unknown) {
    log.warn({ err: String(error) }, 'could not read profits after joins, will retry')
  }
}

function toBytes32(name: string): Hex {
  const bytes = new TextEncoder().encode(name).slice(0, 31)
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `0x${hex.padEnd(64, '0')}` as Hex
}

// --- betting ---------------------------------------------------------------------------

export function betHash(roundId: number, player: Address, side: Side, stake: number, nonce: number): Hex {
  return keccak256(
    encodePacked(
      ['string', 'uint256', 'address', 'uint256', 'address', 'uint8', 'uint128', 'uint32'],
      ['AURAMAXX', BigInt(env.CHAIN_ID), contract, BigInt(roundId), player, side, BigInt(stake), nonce],
    ),
  )
}

export async function bet(
  address: Address,
  side: Side,
  stake: number,
  nonce: number,
  sig: Hex,
): Promise<{ ok: true; staked: number; up: number; down: number } | { ok: false; code: string }> {
  if (!round || (round.phase !== 'open' && round.phase !== 'reveal')) return { ok: false, code: 'CLOSED' }
  if (!players.has(address)) return { ok: false, code: 'UNKNOWN' }
  if (side !== 0 && side !== 1) return { ok: false, code: 'BAD_SIDE' }

  // add-only, but either side is fair game: chips already down cannot move, and the budget is
  // shared, so backing both sides is a real decision rather than a free hedge
  const current = round.stake.get(address) ?? { up: 0, down: 0 }
  const room = BUDGET - (current.up + current.down)
  if (room <= 0) return { ok: false, code: 'BROKE' }
  const amount = Math.min(Math.max(Math.floor(stake), 1), room)

  const hash = betHash(round.id, address, side, amount, nonce)
  const recovered = await recoverMessageAddress({ message: { raw: hash }, signature: sig })
  if (recovered.toLowerCase() !== address.toLowerCase()) return { ok: false, code: 'BAD_SIG' }

  round.entries.push({ player: address, side, stake: amount, nonce, sig })
  if (round.phase === 'reveal') round.rebet.add(address)
  const next = side === 0 ? { ...current, up: current.up + amount } : { ...current, down: current.down + amount }
  round.stake.set(address, next)
  if (side === 0) round.poolUp += amount
  else round.poolDown += amount

  return { ok: true, staked: next.up + next.down, up: next.up, down: next.down }
}

// --- the round machine -------------------------------------------------------------------

/** An operator command that does not fit the game's current state: refused, never half-applied. */
export class StateError extends Error {}

/** A round is being opened on chain right now: a second request must not open a second round. */
let opening = false

/**
 * Opening replaces `round`, so it is only allowed between rounds. Without this, a stale régie tab
 * or a second operator pressing "Open betting" mid-round wiped the round in progress — bets,
 * pause and all — and put a fresh one in its place.
 */
function cannotOpen(): string | null {
  if (opening) return 'a round is already being opened'
  if (round && round.phase !== 'resolved') return `round ${manche} is still ${round.phase}: it has to settle first`
  if (manche >= MANCHES) return `both rounds of this game are played: start a new game`
  return null
}

export async function openRound(kind: 0 | 1): Promise<void> {
  const refused = cannotOpen()
  if (refused) throw new StateError(refused)
  opening = true
  try {
    await openRoundOnChain(kind)
  } finally {
    opening = false
  }
}

async function openRoundOnChain(kind: 0 | 1): Promise<void> {
  // the régie can open a round without anyone having pressed "Start a game" on the projector;
  // give that path a game too, so both entry points leave the same state behind
  if (gameId === 0) newGame()
  // every baseline must be read before this round can pay anyone, or its gains would be counted
  // as last game's; flushJoins normally got there already, this covers a failed read
  if ([...players.values()].some((p) => p.baseline === null)) {
    try {
      await refreshProfits()
    } catch (error: unknown) {
      log.warn({ err: String(error) }, 'could not read starting profits before the round')
    }
  }
  const id = Number(await publicClient().readContract({ address: contract, abi: AURAMAXX_ABI, functionName: 'roundCount' }))
  // the on-chain deadline for committing bets. Betting now opens BEFORE the clock with no time
  // limit, and 900 blocks (~5 min at ~0.3 s) could expire while the room is still betting, which
  // would make every commitBatch revert. 20,000 blocks is roughly an hour and a half.
  const freezeAtBlock = (await blockNumber()) + 20_000n
  await send('openRound', [kind, freezeAtBlock], await gasFor('openRound', [kind, freezeAtBlock], GAS.open))

  round = {
    id,
    kind,
    phase: 'open',
    durationMs: kind === 0 ? Q1_MS : Q2_MS,
    elapsedMs: 0,
    lastTick: Date.now(),
    running: false, // the clock starts on /op/start, once the room has placed its bets
    revealsDone: 0,
    rebet: new Set(),
    hidden: true,
    entries: [],
    stake: new Map(),
    poolUp: 0,
    poolDown: 0,
    threshold: null,
    count: 0,
    visible: 0,
    openPrice: kind === 0 ? (currentPrice()?.price ?? null) : null,
    closePrice: null,
    winner: null,
    txHash: null,
    settleMs: null,
    paid: 0,
  }
  manche += 1
  emit({ type: 'open', roundId: id, kind, manche, manches: MANCHES, durationMs: round.durationMs, openPrice: round.openPrice })
  log.info({ id, kind, openPrice: round.openPrice }, 'round opened')
}

/** Starts the 45 s clock: bets lock, phones go magenta, and the count starts from zero. */
export function start(): void {
  if (!round || round.phase !== 'open') return
  round.phase = 'live'
  round.running = true
  round.lastTick = Date.now()
  round.elapsedMs = 0
  round.count = 0
  round.visible = 0
  cameraSource = null
  emit({ type: 'start', roundId: round.id, durationMs: round.durationMs, threshold: projectedThreshold(round) })
  log.info({ id: round.id, bettors: round.stake.size }, 'clock started')
}

/**
 * The régie restarts the clock after a reveal. The pause lasts as long as the room needs to read
 * the odds and re-bet; the operator decides when that is, never a timer.
 */
export function resume(): boolean {
  if (!round || round.phase !== 'reveal') return false
  round.phase = 'live'
  round.hidden = true
  round.running = true
  round.lastTick = Date.now()
  emit({ type: 'reveal_end', roundId: round.id, n: round.revealsDone, rebet: round.rebet.size })
  log.info({ id: round.id, reveal: round.revealsDone, rebet: round.rebet.size }, 'clock resumed')
  return true
}

/**
 * Same formula as Auramaxx.freeze(), on the same input: every player the contract has registered,
 * ever — not this server's room, which a new game empties while the contract keeps counting. Plus
 * the arrivals still queued for joinBatch whose address the contract does not know yet.
 */
function projectedThreshold(_r: RoundState): number {
  const pending = joinQueue.filter((p) => !knownOnChain.has(p.address)).length
  return Math.floor(((registeredOnChain + pending) * TICKS * THRESHOLD_PCT) / 100)
}

/**
 * The camera page pushes this; it is also what settles a magenta round. Only the running clock
 * counts: lights before the start, during a reveal's pause, or after the end are ignored.
 *
 * One camera page per round: the first to push after the start owns the count, and another only
 * takes over if the owner goes quiet. Two pages (the projector's and a calibration tab left open)
 * each run their own detector, and taking whichever spoke last would make the number jump.
 */
export function cameraUpdate(total: number, visible: number, source: number): void {
  if (!round || round.kind !== 1 || round.phase !== 'live') return
  const now = Date.now()
  if (cameraSource && cameraSource.id !== source && now - cameraSource.at < CAMERA_HANDOVER_MS) return
  cameraSource = { id: source, at: now }
  round.count = total
  round.visible = visible
}

export function setCount(total: number): void {
  if (round) round.count = total
}

export async function freezeNow(): Promise<void> {
  if (!round || round.phase === 'frozen' || round.phase === 'resolved' || round.phase === 'settling') return
  round.phase = 'frozen'
  round.running = false
  round.hidden = false
  emit({ type: 'freeze', roundId: round.id, poolUp: round.poolUp, poolDown: round.poolDown })

  try {
    if (round.entries.length > 0) {
      const chunks = chunk(round.entries, 60)
      for (const c of chunks) {
        const commitArgs = [
          BigInt(round.id),
          c.map((e) => ({ player: e.player, side: e.side, stake: BigInt(e.stake), nonce: e.nonce, sig: e.sig })),
        ] as const
        const committed = await send('commitBatch', commitArgs, await gasFor('commitBatch', commitArgs, GAS.commit(c.length)))
        receipts.push({ label: `Round ${manche} · ${c.length} signed ${c.length === 1 ? 'bet' : 'bets'} on chain`, hash: committed.hash })
      }
    }
    await send('freeze', [BigInt(round.id)], await gasFor('freeze', [BigInt(round.id)], GAS.freeze))
    if (round.kind === 1) {
      const onChain = (await publicClient().readContract({
        address: contract,
        abi: AURAMAXX_ABI,
        functionName: 'getRound',
        args: [BigInt(round.id)],
      })) as unknown as readonly [{ threshold: number }, bigint]
      round.threshold = Number(onChain[0].threshold)
      emit({ type: 'threshold', roundId: round.id, threshold: round.threshold })
    }
  } catch (error: unknown) {
    log.error({ err: String(error) }, 'freeze failed')
  }
}

export async function settle(): Promise<void> {
  const r = round
  if (!r || r.phase === 'resolved' || r.phase === 'settling') return
  r.phase = 'settling'
  const started = Date.now()

  try {
    if (r.kind === 0) {
      const close = priceScaled()
      const open = r.openPrice === null ? null : BigInt(Math.round(r.openPrice * 100))
      if (open === null || close === null) throw new Error('missing price')
      r.closePrice = Number(close) / 100
      const priceArgs = [BigInt(r.id), open, close] as const
      const result = await send('resolveByPrice', priceArgs, await gasFor('resolveByPrice', priceArgs, GAS.resolve(r.entries.length)))
      r.txHash = result.hash
      r.settleMs = result.ms
      r.winner = close > open ? 0 : 1
    } else {
      const countArgs = [BigInt(r.id), r.count] as const
      const result = await send('resolveByCount', countArgs, await gasFor('resolveByCount', countArgs, GAS.resolve(r.entries.length)))
      r.txHash = result.hash
      r.settleMs = result.ms
      r.winner = r.threshold !== null && r.count > r.threshold ? 0 : 1
    }

    if (r.txHash) receipts.push({ label: `Round ${manche} · settled`, hash: r.txHash })
    await refreshProfits()
    const winner = r.winner
    r.paid = [...r.stake.values()].filter((s) => (winner === 0 ? s.up : s.down) > 0).length
    r.phase = 'resolved'

    emit({
      type: 'resolved',
      roundId: r.id,
      winner: r.winner,
      count: r.count,
      threshold: r.threshold,
      openPrice: r.openPrice,
      closePrice: r.closePrice,
      poolUp: r.poolUp,
      poolDown: r.poolDown,
      paid: r.paid,
      // nobody bet: the room still sees the count against the line, but nothing was won or lost
      bettors: r.stake.size,
      txHash: r.txHash,
      settleMs: r.settleMs,
      leaderboard: leaderboard(),
      receipts,
    })
    log.info({ id: r.id, winner: r.winner, ms: Date.now() - started }, 'round resolved')

    if (manche >= MANCHES) {
      finalStandings = standings()
      emit({ type: 'final', standings: finalStandings })
    }
  } catch (error: unknown) {
    log.error({ err: String(error) }, 'settle failed')
    r.phase = 'frozen'
  }
}

/** Every registered player's cumulative profit, straight from the contract. */
async function readOnChainProfits(): Promise<Map<Address, number>> {
  const count = Number(
    await publicClient().readContract({ address: contract, abi: AURAMAXX_ABI, functionName: 'playerCount' }),
  )
  const profits = new Map<Address, number>()
  if (count > 0) {
    const [addrs, , , raw] = (await publicClient().readContract({
      address: contract,
      abi: AURAMAXX_ABI,
      functionName: 'getPlayers',
      args: [0, count],
    })) as [Address[], Hex[], number[], bigint[]]
    addrs.forEach((address, i) => profits.set(address, Number(raw[i] ?? 0n)))
  }
  registeredOnChain = count
  for (const address of profits.keys()) knownOnChain.add(address)
  return profits
}

/**
 * Reads profits back from the contract — never from logs, which only reach back 100 blocks — and
 * turns them into this game's score: what each player has gained since they joined this game.
 */
export async function refreshProfits(): Promise<Map<Address, number>> {
  const onChain = await readOnChainProfits()
  for (const p of players.values()) {
    // an address the contract does not know yet is a new player, and a new player starts at 0
    const cumulative = onChain.get(p.address) ?? 0
    if (p.baseline === null) p.baseline = cumulative
    p.profit = Math.max(0, cumulative - p.baseline)
  }
  return onChain
}

/**
 * payoutMon pays every registered player the contract owes — including profit left unpaid by an
 * earlier game, since the contract cannot tell games apart. The numbers announced are therefore
 * computed from the contract's own figures for the whole range, so they match the transaction.
 */
export async function payout(): Promise<{ hash: Hex | null; total: number; winners: number }> {
  // a round still running has profits still to come: paying now would pay the room twice over
  if (round && round.phase !== 'resolved') {
    throw new StateError(`round ${manche} is still ${round.phase}: pay out once it has settled`)
  }
  const owed = [...(await refreshProfits()).values()].filter((profit) => profit > 0)
  const total = owed.reduce((sum, profit) => sum + profit / 100, 0)
  if (owed.length === 0) {
    // nobody made a profit (nobody bet, or every bet came back): no transaction to send and no hash
    // to show. The screens say so instead of announcing a payment that did not happen.
    emit({ type: 'payout', txHash: null, totalMon: 0, winners: 0, receipts })
    log.info('payout skipped: nothing owed')
    return { hash: null, total: 0, winners: 0 }
  }
  const payoutArgs = [0, registeredOnChain] as const
  const result = await send('payoutMon', payoutArgs, await gasFor('payoutMon', payoutArgs, GAS.payout(registeredOnChain)))
  receipts.push({ label: `MON payout · ${owed.length} ${owed.length === 1 ? 'winner' : 'winners'}`, hash: result.hash })
  emit({ type: 'payout', txHash: result.hash, totalMon: total, winners: owed.length, receipts })
  return { hash: result.hash, total, winners: owed.length }
}

/**
 * Everyone who has joined, in arrival order, for the projector's lobby wall. Separate from the
 * leaderboard, which is sorted by profit and capped at 20: here the whole room has to appear, and
 * seeing your own name land is the point.
 */
export function roster(): Array<{ address: Address; name: string; avatar: number }> {
  return [...players.values()]
    .filter((p) => p.game === gameId)
    .map((p) => ({ address: p.address, name: p.name, avatar: p.avatar }))
}

/** This game's players only, best first: what the final podium shows (top 3 + 4th to 10th). */
function standings(): Standing[] {
  return [...players.values()]
    .filter((p) => p.game === gameId)
    .map((p) => ({ address: p.address, name: p.name, avatar: p.avatar, profit: p.profit }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 10)
}

export function leaderboard(): Array<{ name: string; avatar: number; profit: number; address: Address }> {
  return [...players.values()]
    .map((p) => ({ name: p.name, avatar: p.avatar, profit: p.profit, address: p.address }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 20)
}

export function snapshot(address?: Address): Record<string, unknown> {
  const you = address ? players.get(address) : undefined
  const staked = address && round ? round.stake.get(address) : undefined
  return {
    type: 'snapshot',
    // the room in THIS game, not everyone the server has ever seen
    players: roster().length,
    gameId,
    manche,
    manches: MANCHES,
    round: round
      ? {
          id: round.id,
          kind: round.kind,
          phase: round.phase,
          hidden: round.hidden,
          remainingMs: Math.max(0, round.durationMs - round.elapsedMs),
          threshold: round.threshold ?? projectedThreshold(round),
          // the count is the room's own action and bets are locked while it runs, so it is public;
          // only the pools are withheld outside a reveal
          count: round.count,
          visible: round.visible,
          revealsDone: round.revealsDone,
          // how many have bet, never on which side: it tells the régie whether to wait, and tells
          // nobody anything about the pools
          bettors: round.stake.size,
          rebet: round.rebet.size,
          // counts are withheld entirely while hidden: sending them and hiding them client-side
          // puts them one DevTools tab away
          ...(round.hidden
            ? {}
            : {
                poolUp: round.poolUp,
                poolDown: round.poolDown,
              }),
        }
      : null,
    you: you
      ? {
          name: you.name,
          avatar: you.avatar,
          profit: you.profit,
          up: staked?.up ?? 0,
          down: staked?.down ?? 0,
          staked: (staked?.up ?? 0) + (staked?.down ?? 0),
          budget: BUDGET,
        }
      : null,
    leaderboard: leaderboard(),
    final: finalStandings,
    receipts,
    roster: roster(),
    price: currentPrice(),
    priceHistory: priceHistory(Date.now() - 120_000),
  }
}

export function state(): RoundState | null {
  return round
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Must match Auramaxx.mult() exactly — the phone and the contract cannot disagree about odds.
 * paper §3: exact T/P_i once a side has money, regularised (T+k)/(P_i+1) with k=2 when it is
 * empty (cosmetic, never stored). An empty side means a refund if it wins, so the UI shows
 * anything above 99x as ">99x" rather than a number that looks broken.
 */
export function multipliers(r: { poolUp: number; poolDown: number }): { up: number; down: number } {
  const total = r.poolUp + r.poolDown
  if (total === 0) return { up: 200, down: 200 }
  return {
    up: r.poolUp === 0 ? Math.floor((100 * (total + 2)) / 1) : Math.floor((100 * total) / r.poolUp),
    down: r.poolDown === 0 ? Math.floor((100 * (total + 2)) / 1) : Math.floor((100 * total) / r.poolDown),
  }
}

// --- the 10 Hz loop ---------------------------------------------------------------------

export function startLoop(): void {
  // the BTC price is public information, so it streams even while the pools stay hidden
  onPrice((point) => {
    const r = round
    emit({
      type: 'price',
      p: point.p,
      t: point.t,
      openPrice: r?.kind === 0 ? r.openPrice : null,
      phase: r?.phase ?? 'idle',
    })
  })

  setInterval(() => void flushJoins(), 2000)
  setInterval(() => void tickGas(), 15_000)
  // the projected line needs the contract's registered count from the first round on, even after
  // a restart that left this server with an empty room
  refreshProfits().catch((error: unknown) => log.warn({ err: String(error) }, 'could not read the registered players at boot'))

  setInterval(() => {
    const r = round
    if (!r) return

    if (r.running) {
      const now = Date.now()
      r.elapsedMs += now - r.lastTick
      r.lastTick = now

      const first = r.durationMs / 3
      const second = (r.durationMs * 2) / 3

      if (r.revealsDone === 0 && r.elapsedMs >= first) doReveal(r, 1)
      else if (r.revealsDone === 1 && r.elapsedMs >= second) doReveal(r, 2)
      else if (r.elapsedMs >= r.durationMs) {
        r.running = false
        void endRound()
      }
    }

    emit({
      type: 'tick',
      phase: r.phase,
      remainingMs: Math.max(0, r.durationMs - r.elapsedMs),
      hidden: r.hidden,
      ...(r.hidden ? {} : { poolUp: r.poolUp, poolDown: r.poolDown, ...multipliers(r) }),
      count: r.count,
      visible: r.visible,
      threshold: r.threshold ?? projectedThreshold(r),
      bettors: r.stake.size,
      rebet: r.rebet.size,
    })
  }, 100)
}

/** 45 s are up: lock, commit, and settle without waiting for the régie. */
async function endRound(): Promise<void> {
  await freezeNow()
  if (round?.phase === 'frozen') await settle() // settle() puts it back to 'frozen' on failure: the régie can retry
}

/** 1/3 or 2/3 of the clock: pause it, show the odds, reopen betting until the régie resumes. */
function doReveal(r: RoundState, n: number): void {
  r.revealsDone = n
  r.phase = 'reveal'
  r.running = false
  r.rebet = new Set()
  r.hidden = false
  const m = multipliers(r)
  emit({
    type: 'reveal',
    n,
    roundId: r.id,
    // a hedged player is counted on both sides, because they really are on both
    up_count: [...r.stake.values()].filter((s) => s.up > 0).length,
    down_count: [...r.stake.values()].filter((s) => s.down > 0).length,
    poolUp: r.poolUp,
    poolDown: r.poolDown,
    mult_up_x100: m.up,
    mult_down_x100: m.down,
    bettors: r.stake.size,
    paused: true,
    remainingMs: Math.max(0, r.durationMs - r.elapsedMs),
    count: r.count,
    threshold: projectedThreshold(r),
  })
  log.info({ n, poolUp: r.poolUp, poolDown: r.poolDown }, 'reveal')
}

async function tickGas(): Promise<void> {
  try {
    const { spent, balance } = await gasSpent()
    emit({ type: 'gas', spent, balance })
  } catch {
    /* the gauge is not worth a crash */
  }
}
