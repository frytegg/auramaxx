import { log } from './log.js'

/**
 * Round 1's oracle. We measured every BTC feed on Monad testnet this morning: RedStone reverts
 * on a stale timestamp, Pyth's price was 29 hours old, and Stork — the only live one — updated
 * once in two minutes. A 30-second round needs a price that actually moves, so the backend is
 * the oracle and we say so on stage.
 */
const SOURCES = [
  {
    name: 'binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
    pick: (j: unknown): number => Number((j as { price: string }).price),
  },
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    pick: (j: unknown): number => Number((j as { data: { amount: string } }).data.amount),
  },
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    pick: (j: unknown): number => {
      const result = (j as { result: Record<string, { c: string[] }> }).result
      const first = Object.values(result)[0]
      return Number(first?.c?.[0])
    },
  },
] as const

let last: { price: number; at: number; source: string } | null = null
let timer: NodeJS.Timeout | null = null

async function poll(): Promise<void> {
  for (const source of SOURCES) {
    try {
      const controller = new AbortController()
      const abort = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(source.url, { signal: controller.signal })
      clearTimeout(abort)
      if (!response.ok) continue
      const price = source.pick(await response.json())
      if (Number.isFinite(price) && price > 0) {
        last = { price, at: Date.now(), source: source.name }
        return
      }
    } catch (error: unknown) {
      log.debug({ source: source.name, err: String(error) }, 'price source failed')
    }
  }
  log.warn('every price source failed')
}

export function startPricePolling(): void {
  if (timer) return
  void poll()
  timer = setInterval(() => void poll(), 1000)
}

export function currentPrice(): { price: number; at: number; source: string } | null {
  return last
}

/** Price scaled to 2 decimals as an integer, which is what the contract compares. */
export function priceScaled(): bigint | null {
  return last ? BigInt(Math.round(last.price * 100)) : null
}
