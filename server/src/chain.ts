import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { env } from './env.js'
import { log } from './log.js'
import { AURAMAXX_ABI } from './abi.js'

export const monadTestnet = defineChain({
  id: env.CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL, env.RPC_URL_FALLBACK] } },
})

export const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex)
export const contract = env.CONTRACT_ADDRESS as Address

// Two clients so we can fail over: the venue DNS dropped twice this morning.
const transports = [env.RPC_URL, env.RPC_URL_FALLBACK]
let rpcIndex = 0
const clients = transports.map((url) =>
  createPublicClient({ chain: monadTestnet, transport: http(url, { timeout: 12_000, retryCount: 1 }) }),
)
const wallets = transports.map((url) =>
  createWalletClient({ account, chain: monadTestnet, transport: http(url, { timeout: 12_000, retryCount: 1 }) }),
)

export const publicClient = () => clients[rpcIndex]!
export const walletClient = () => wallets[rpcIndex]!

export function failoverRpc(): string {
  rpcIndex = (rpcIndex + 1) % transports.length
  log.warn({ rpc: transports[rpcIndex] }, 'rpc failover')
  return transports[rpcIndex]!
}

/**
 * Gas limits are HARDCODED from real receipts, never estimated.
 * Monad charges the limit, not the usage, so every unused unit is money burned —
 * and an estimate that is too low burns the whole transaction for nothing.
 * Measured 2026-09-19: a 60,000-limit call was charged exactly 60,000 (0.00648 MON at 108 gwei).
 */
export const GAS = {
  join: (n: number) => BigInt(60_000 + 120_000 * n), // measured: ~95k/player + 45k base
  commit: (n: number) => BigInt(120_000 + 160_000 * n),
  freeze: 250_000n,
  resolve: (n: number) => BigInt(300_000 + 120_000 * n),
  payout: (n: number) => BigInt(200_000 + 120_000 * n),
  open: 250_000n,
} as const

/**
 * Monad charges the LIMIT, so a limit that is too high wastes MON — but a limit that is too low
 * burns the whole transaction and reverts. We estimate (which returns real execution gas, unlike
 * receipts, where gasUsed always equals the limit) and add 30%. The hardcoded value above is the
 * fallback when the estimate itself fails.
 */
export async function gasFor(
  functionName: string,
  args: readonly unknown[],
  fallback: bigint,
): Promise<bigint> {
  try {
    const estimate = await publicClient().estimateContractGas({
      address: contract,
      abi: AURAMAXX_ABI,
      functionName,
      args,
      account,
    } as never)
    const withMargin = (estimate * 130n) / 100n
    return withMargin > fallback ? withMargin : fallback
  } catch (error: unknown) {
    log.warn({ functionName, err: String(error) }, 'gas estimate failed, using fallback')
    return fallback
  }
}

const MAX_FEE = 130_000_000_000n // 130 gwei
const PRIORITY = 8_000_000_000n // the node suggests 2 gwei; the real median is ~8, and a
// default-priced transaction sorts to the bottom of the block

let nonce: number | null = null

async function nextNonce(): Promise<number> {
  if (nonce === null) {
    nonce = await publicClient().getTransactionCount({ address: account.address, blockTag: 'latest' })
  }
  return nonce++
}

export function resyncNonce(): void {
  nonce = null
}

export type SendResult = { hash: Hex; blockNumber: bigint | null; ms: number; sync: boolean }

/**
 * Sends through eth_sendRawTransactionSync when possible (a receipt in ~470 ms measured on the
 * venue network today), and falls back to the async path plus a receipt poll on any error.
 * The timeout MUST be an integer — a hex string is rejected with -32602.
 */
export async function send(
  functionName: string,
  args: readonly unknown[],
  gas: bigint,
): Promise<SendResult> {
  const started = Date.now()
  const data = encodeFunctionData({ abi: AURAMAXX_ABI, functionName, args } as never)

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const n = await nextNonce()
      const serialized = await account.signTransaction({
        chainId: env.CHAIN_ID,
        to: contract,
        data,
        gas,
        maxFeePerGas: MAX_FEE,
        maxPriorityFeePerGas: PRIORITY,
        nonce: n,
        type: 'eip1559',
      })

      try {
        const receipt = (await publicClient().request({
          method: 'eth_sendRawTransactionSync' as never,
          params: [serialized, 3000] as never,
        })) as { transactionHash: Hex; blockNumber: Hex; status: Hex }
        // A reverted transaction still returns a receipt. Never report success without
        // reading the status — that is how you end up telling a room something landed
        // when the chain says otherwise.
        if (receipt.status !== '0x1') {
          throw new Error(`reverted on chain: ${functionName} tx=${receipt.transactionHash}`)
        }
        log.info(
          { functionName, hash: receipt.transactionHash, ms: Date.now() - started, gas: gas.toString() },
          'tx ok',
        )
        return {
          hash: receipt.transactionHash,
          blockNumber: BigInt(receipt.blockNumber),
          ms: Date.now() - started,
          sync: true,
        }
      } catch (error: unknown) {
        if (String(error).includes('reverted on chain')) throw error
        log.warn({ err: String(error), functionName }, 'sync send failed, falling back to async')
        const hash = await walletClient().sendRawTransaction({ serializedTransaction: serialized })
        const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: 20_000 })
        if (receipt.status !== 'success') throw new Error(`reverted on chain: ${functionName} tx=${hash}`)
        log.info({ functionName, hash, ms: Date.now() - started }, 'tx ok (async)')
        return { hash, blockNumber: receipt.blockNumber, ms: Date.now() - started, sync: false }
      }
    } catch (error: unknown) {
      log.error({ err: String(error), functionName, attempt }, 'send failed')
      resyncNonce()
      failoverRpc()
      if (attempt === 1) throw error
    }
  }
  throw new Error('unreachable')
}

export async function blockNumber(): Promise<bigint> {
  try {
    return await publicClient().getBlockNumber()
  } catch {
    failoverRpc()
    return publicClient().getBlockNumber()
  }
}

/** Cumulative gas spend, read as a balance delta — the only honest way on Monad. */
let startingBalance: bigint | null = null
export async function gasSpent(): Promise<{ spent: number; balance: number }> {
  const balance = await publicClient().getBalance({ address: account.address })
  if (startingBalance === null) startingBalance = balance
  return { spent: Number(startingBalance - balance) / 1e18, balance: Number(balance) / 1e18 }
}
