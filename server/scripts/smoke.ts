/**
 * End-to-end smoke test: three phones join, bet, and get settled on chain.
 * Run against a live server:  pnpm tsx scripts/smoke.ts
 */
import { encodePacked, keccak256, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:8080'
const WS_URL = BASE.replace('http', 'ws') + '/ws'
const OP = process.env.OP_KEY ?? 'changeme-op-panel-secret'
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 10143)

const config = (await (await fetch(`${BASE}/api/config`)).json()) as { contract: Address }
const contract = config.contract
console.log('contract', contract)

const wallets = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()))
const names = ['alice', 'bob', 'carol']

function betHash(roundId: number, player: Address, side: number, stake: number, nonce: number): Hex {
  return keccak256(
    encodePacked(
      ['string', 'uint256', 'address', 'uint256', 'address', 'uint8', 'uint128', 'uint32'],
      ['AURAMAXX', BigInt(CHAIN_ID), contract, BigInt(roundId), player, side, BigInt(stake), nonce],
    ),
  )
}

const sockets = wallets.map((w, i) => {
  const socket = new WebSocket(WS_URL)
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join', address: w.address, name: names[i], avatar: i }))
  })
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as Record<string, unknown>
    if (['resolved', 'reveal', 'freeze', 'error', 'bet_ok'].includes(String(msg.type))) {
      console.log(`  [${names[i]}]`, JSON.stringify(msg).slice(0, 220))
    }
  })
  return socket
})

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const op = async (path: string, query = ''): Promise<unknown> =>
  (await fetch(`${BASE}/op/${path}?k=${encodeURIComponent(OP)}${query}`, { method: 'POST' })).json()

await wait(4000)
console.log('joined; opening a price round')
console.log(await op('open', '&kind=0'))
await wait(2000)

const health = (await (await fetch(`${BASE}/health`)).json()) as { roundId: number | null }
const roundId = health.roundId ?? 0
console.log('round id', roundId)

for (const [i, w] of wallets.entries()) {
  const side = i === 2 ? 1 : 0
  const stake = 100 * (i + 1)
  const hash = betHash(roundId, w.address, side, stake, 1)
  const sig = await w.signMessage({ message: { raw: hash } })
  sockets[i]!.send(JSON.stringify({ type: 'bet', side, stake, nonce: 1, sig }))
  console.log(`  ${names[i]} bets ${stake} on ${side === 0 ? 'UP' : 'DOWN'}`)
}

await wait(11000) // first reveal pauses the clock
console.log('resume ->', await op('resume'))
await wait(11000)
console.log('resume ->', await op('resume'))
await wait(11000)
console.log('freeze ->', await op('freeze'))
await wait(4000)
console.log('settle ->', await op('settle'))
await wait(6000)
console.log('leaderboard', await (await fetch(`${BASE}/api/leaderboard`)).json())
process.exit(0)
