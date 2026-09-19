import type { Address, Hex } from 'viem'
import { log } from './log.js'
import type { SendResult } from './chain.js'

/**
 * DEMO=1: an in-memory stand-in for the Auramaxx contract, so the whole app (phones, projector,
 * régie) can be previewed on a laptop with no relayer key, no deployed contract and no MON.
 * It mirrors exactly the functions game.ts calls, with the same maths as Auramaxx.sol
 * (threshold = bettors × TICKS × 45%, parimutuel payout stake × total / winningPool, refund
 * when the winning side is empty). Nothing here ever touches a network.
 */
export const DEMO = process.env.DEMO === '1' || process.argv.includes('--demo')

const TICKS = 11
const THRESHOLD_PCT = 45

type Entry = { player: Address; side: number; stake: bigint }
type Round = {
  kind: number
  status: number
  poolUp: bigint
  poolDown: bigint
  threshold: number
  bettors: Map<Address, { side: number; stake: bigint }>
}

const players: Array<{ addr: Address; name: Hex; avatar: number; profit: bigint }> = []
const rounds: Round[] = []
let block = 1_000_000n

function fakeHash(): Hex {
  const bytes = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
  return `0x${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
}

function settle(r: Round, winner: number): void {
  const total = r.poolUp + r.poolDown
  const pw = winner === 0 ? r.poolUp : r.poolDown
  for (const [addr, b] of r.bettors) {
    const payout = pw === 0n ? b.stake : b.side === winner ? (b.stake * total) / pw : 0n
    if (payout > b.stake) {
      const p = players.find((x) => x.addr.toLowerCase() === addr.toLowerCase())
      if (p) p.profit += payout - b.stake
    }
  }
  r.status = 2
}

export async function demoSend(functionName: string, args: readonly unknown[]): Promise<SendResult> {
  const started = Date.now()
  await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250)) // feels like a block
  const a = args as unknown[]

  switch (functionName) {
    case 'joinBatch': {
      const [who, names, avatars] = a as [Address[], Hex[], number[]]
      who.forEach((addr, i) => {
        if (!players.some((p) => p.addr === addr)) {
          players.push({ addr, name: names[i]!, avatar: avatars[i]!, profit: 0n })
        }
      })
      break
    }
    case 'openRound':
      rounds.push({ kind: Number(a[0]), status: 0, poolUp: 0n, poolDown: 0n, threshold: 0, bettors: new Map() })
      break
    case 'commitBatch': {
      const r = rounds[Number(a[0])]!
      for (const e of a[1] as Entry[]) {
        const current = r.bettors.get(e.player)
        r.bettors.set(e.player, { side: e.side, stake: (current?.stake ?? 0n) + e.stake })
        if (e.side === 0) r.poolUp += e.stake
        else r.poolDown += e.stake
      }
      break
    }
    case 'freeze': {
      const r = rounds[Number(a[0])]!
      r.status = 1
      if (r.kind === 1) r.threshold = Math.floor((r.bettors.size * TICKS * THRESHOLD_PCT) / 100)
      break
    }
    case 'resolveByPrice': {
      const [id, open, close] = a as [bigint, bigint, bigint]
      settle(rounds[Number(id)]!, close > open ? 0 : 1)
      break
    }
    case 'resolveByCount': {
      const [id, count] = a as [bigint, number]
      const r = rounds[Number(id)]!
      settle(r, count > r.threshold ? 0 : 1)
      break
    }
    case 'payoutMon':
      for (const p of players) p.profit = 0n
      break
    default:
      break
  }

  block += 1n
  const hash = fakeHash()
  log.info({ functionName, hash, demo: true }, 'tx ok (demo)')
  return { hash, blockNumber: block, ms: Date.now() - started, sync: true }
}

/** Only the reads game.ts makes. */
export const demoClient = {
  async readContract({ functionName, args }: { functionName: string; args?: readonly unknown[] }): Promise<unknown> {
    switch (functionName) {
      case 'roundCount':
        return BigInt(rounds.length)
      case 'playerCount':
        return BigInt(players.length)
      case 'getRound': {
        const r = rounds[Number(args?.[0])]!
        return [{ threshold: r.threshold }, BigInt(r.bettors.size)]
      }
      case 'getPlayers': {
        const list = players.slice(Number(args?.[0] ?? 0), Number(args?.[1] ?? players.length))
        return [list.map((p) => p.addr), list.map((p) => p.name), list.map((p) => p.avatar), list.map((p) => p.profit)]
      }
      default:
        throw new Error(`demo: unsupported read ${functionName}`)
    }
  },
}

export function demoBlock(): bigint {
  return block
}

/** A believable BTC random walk for when the laptop is offline. */
let walk = 64_000 + Math.random() * 2_000
export function demoPrice(): number {
  walk += (Math.random() - 0.5) * 18
  return Math.round(walk * 100) / 100
}
