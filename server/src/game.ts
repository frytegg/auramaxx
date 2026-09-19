import { encodePacked, keccak256, recoverMessageAddress, type Address, type Hex } from 'viem'
import { env } from './env.js'
import { log } from './log.js'
import { GAS, blockNumber, contract, gasFor, gasSpent, publicClient, send } from './chain.js'
import { AURAMAXX_ABI } from './abi.js'
import { currentPrice, priceScaled } from './price.js'

export const BUDGET = 1000
export const Q1_MS = 30_000
export const Q2_MS = 45_000

export type Side = 0 | 1
export type Phase = 'idle' | 'open' | 'reveal' | 'frozen' | 'settling' | 'resolved'

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
  profit: number
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
  hidden: boolean
  entries: Entry[]
  stake: Map<Address, { side: Side; total: number }>
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
let joinQueue: Player[] = []
const listeners = new Set<(event: unknown) => void>()

export function onBroadcast(fn: (event: unknown) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(event: Record<string, unknown>): void {
  for (const fn of listeners) fn(event)
}

// --- joining ---------------------------------------------------------------------------

export function join(address: Address, name: string, avatar: number): Player {
  const existing = players.get(address)
  if (existing) return existing
  const clean = name.trim().slice(0, 12) || 'anon'
  const player: Player = { address, name: clean, avatar: avatar % 12, onChain: false, profit: 0 }
  players.set(address, player)
  joinQueue.push(player)
  emit({ type: 'joined', name: clean, avatar: player.avatar, total: players.size })
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
    joinQueue = [...batch, ...joinQueue]
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
): Promise<{ ok: true; staked: number } | { ok: false; code: string }> {
  if (!round || (round.phase !== 'open' && round.phase !== 'reveal')) return { ok: false, code: 'CLOSED' }
  if (!players.has(address)) return { ok: false, code: 'UNKNOWN' }
  if (side !== 0 && side !== 1) return { ok: false, code: 'BAD_SIDE' }

  const current = round.stake.get(address)
  // add-only: a reveal lets you add to your side, never move to the other one
  if (current && current.side !== side) return { ok: false, code: 'NO_SWITCH' }

  const room = BUDGET - (current?.total ?? 0)
  if (room <= 0) return { ok: false, code: 'BROKE' }
  const amount = Math.min(Math.max(Math.floor(stake), 1), room)

  const hash = betHash(round.id, address, side, amount, nonce)
  const recovered = await recoverMessageAddress({ message: { raw: hash }, signature: sig })
  if (recovered.toLowerCase() !== address.toLowerCase()) return { ok: false, code: 'BAD_SIG' }

  round.entries.push({ player: address, side, stake: amount, nonce, sig })
  round.stake.set(address, { side, total: (current?.total ?? 0) + amount })
  if (side === 0) round.poolUp += amount
  else round.poolDown += amount

  return { ok: true, staked: (current?.total ?? 0) + amount }
}

// --- the round machine -------------------------------------------------------------------

export async function openRound(kind: 0 | 1): Promise<void> {
  const id = Number(await publicClient().readContract({ address: contract, abi: AURAMAXX_ABI, functionName: 'roundCount' }))
  const freezeAtBlock = (await blockNumber()) + 900n // generous on-chain bound; the operator drives the real timing
  await send('openRound', [kind, freezeAtBlock], await gasFor('openRound', [kind, freezeAtBlock], GAS.open))

  round = {
    id,
    kind,
    phase: 'open',
    durationMs: kind === 0 ? Q1_MS : Q2_MS,
    elapsedMs: 0,
    lastTick: Date.now(),
    running: true,
    revealsDone: 0,
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
  emit({ type: 'open', roundId: id, kind, durationMs: round.durationMs, openPrice: round.openPrice })
  log.info({ id, kind, openPrice: round.openPrice }, 'round opened')
}

export function resume(): void {
  if (!round || round.phase !== 'reveal') return
  round.phase = 'open'
  round.hidden = true
  round.running = true
  round.lastTick = Date.now()
  emit({ type: 'resume', roundId: round.id })
}

/** The camera page pushes this; it is also what settles a magenta round. */
export function cameraUpdate(total: number, visible: number): void {
  if (!round || round.kind !== 1) return
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
        await send('commitBatch', commitArgs, await gasFor('commitBatch', commitArgs, GAS.commit(c.length)))
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

    await refreshProfits()
    const winner = r.winner
    r.paid = [...r.stake.values()].filter((s) => s.side === winner).length
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
      txHash: r.txHash,
      settleMs: r.settleMs,
      leaderboard: leaderboard(),
    })
    log.info({ id: r.id, winner: r.winner, ms: Date.now() - started }, 'round resolved')
  } catch (error: unknown) {
    log.error({ err: String(error) }, 'settle failed')
    r.phase = 'frozen'
  }
}

/** Reads profits back from the contract — never from logs, which only reach back 100 blocks. */
export async function refreshProfits(): Promise<void> {
  const count = Number(
    await publicClient().readContract({ address: contract, abi: AURAMAXX_ABI, functionName: 'playerCount' }),
  )
  if (count === 0) return
  const [addrs, , , profits] = (await publicClient().readContract({
    address: contract,
    abi: AURAMAXX_ABI,
    functionName: 'getPlayers',
    args: [0, count],
  })) as [Address[], Hex[], number[], bigint[]]
  addrs.forEach((address, i) => {
    const p = players.get(address)
    if (p) p.profit = Number(profits[i] ?? 0n)
  })
}

export async function payout(): Promise<{ hash: Hex; total: number; winners: number }> {
  await refreshProfits()
  const winners = [...players.values()].filter((p) => p.profit > 0)
  const total = winners.reduce((sum, p) => sum + p.profit / 100, 0)
  const count = Number(
    await publicClient().readContract({ address: contract, abi: AURAMAXX_ABI, functionName: 'playerCount' }),
  )
  const payoutArgs = [0, count] as const
  const result = await send('payoutMon', payoutArgs, await gasFor('payoutMon', payoutArgs, GAS.payout(count)))
  emit({ type: 'payout', txHash: result.hash, totalMon: total, winners: winners.length })
  return { hash: result.hash, total, winners: winners.length }
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
    players: players.size,
    round: round
      ? {
          id: round.id,
          kind: round.kind,
          phase: round.phase,
          hidden: round.hidden,
          remainingMs: Math.max(0, round.durationMs - round.elapsedMs),
          threshold: round.threshold,
          // counts are withheld entirely while hidden: sending them and hiding them client-side
          // puts them one DevTools tab away
          ...(round.hidden
            ? {}
            : {
                poolUp: round.poolUp,
                poolDown: round.poolDown,
                count: round.count,
                visible: round.visible,
              }),
        }
      : null,
    you: you
      ? { name: you.name, avatar: you.avatar, profit: you.profit, side: staked?.side ?? null, staked: staked?.total ?? 0, budget: BUDGET }
      : null,
    leaderboard: leaderboard(),
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

function multipliers(r: RoundState): { up: number; down: number } {
  const total = r.poolUp + r.poolDown
  if (total === 0) return { up: 200, down: 200 }
  return {
    up: r.poolUp === 0 ? 0 : Math.floor((100 * total) / r.poolUp),
    down: r.poolDown === 0 ? 0 : Math.floor((100 * total) / r.poolDown),
  }
}

// --- the 10 Hz loop ---------------------------------------------------------------------

export function startLoop(): void {
  setInterval(() => void flushJoins(), 2000)
  setInterval(() => void tickGas(), 15_000)

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
      else if (r.elapsedMs >= r.durationMs) void freezeNow()
    }

    emit({
      type: 'tick',
      phase: r.phase,
      remainingMs: Math.max(0, r.durationMs - r.elapsedMs),
      hidden: r.hidden,
      ...(r.hidden ? {} : { poolUp: r.poolUp, poolDown: r.poolDown, ...multipliers(r) }),
      ...(r.kind === 1 && !r.hidden ? { count: r.count, visible: r.visible } : {}),
    })
  }, 100)
}

function doReveal(r: RoundState, n: number): void {
  r.revealsDone = n
  r.phase = 'reveal'
  r.running = false
  r.hidden = false
  const m = multipliers(r)
  emit({
    type: 'reveal',
    n,
    roundId: r.id,
    up_count: [...r.stake.values()].filter((s) => s.side === 0).length,
    down_count: [...r.stake.values()].filter((s) => s.side === 1).length,
    poolUp: r.poolUp,
    poolDown: r.poolDown,
    mult_up_x100: m.up,
    mult_down_x100: m.down,
    ...(r.kind === 1 ? { count: r.count, threshold: r.threshold } : {}),
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
