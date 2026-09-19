import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import type { Address, Hex } from 'viem'
import QRCode from 'qrcode'
import { env } from './env.js'
import { log } from './log.js'
import { contract } from './chain.js'
import { startPricePolling, currentPrice } from './price.js'
import {
  bet,
  cameraUpdate,
  freezeNow,
  join,
  leaderboard,
  onBroadcast,
  openRound,
  payout,
  resume,
  settle,
  snapshot,
  startLoop,
  state,
} from './game.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = Fastify({ logger: false, trustProxy: true })

await app.register(websocket)
await app.register(fastifyStatic, {
  root: path.resolve(here, '../../web/dist'),
  wildcard: false,
})

type Socket = { send: (data: string) => void; readyState: number }
const sockets = new Map<Socket, { address?: Address }>()
let seq = 0

function broadcast(event: unknown): void {
  const payload = JSON.stringify({ ...(event as object), seq: ++seq })
  for (const [socket] of sockets) {
    try {
      if (socket.readyState === 1) socket.send(payload)
    } catch {
      sockets.delete(socket)
    }
  }
}
onBroadcast(broadcast)

function sendTo(socket: Socket, event: unknown): void {
  try {
    socket.send(JSON.stringify({ ...(event as object), seq: ++seq }))
  } catch {
    /* the socket will be cleaned up on close */
  }
}

app.get('/health', async () => ({
  ok: true,
  contract,
  players: snapshot().players,
  price: currentPrice(),
  round: state()?.phase ?? 'idle',
  roundId: state()?.id ?? null,
  kind: state()?.kind ?? null,
}))

app.get('/api/config', async () => ({
  contract,
  chainId: env.CHAIN_ID,
  rpc: env.RPC_URL,
  explorer: 'https://testnet.monadvision.com',
}))

app.get('/api/leaderboard', async () => ({ leaderboard: leaderboard() }))

/** The join QR for the projector. Rendered server-side so the screen page stays dependency-free. */
app.get('/api/qr.svg', async (request, reply) => {
  const query = request.query as { url?: string }
  const target = query.url ?? `${request.protocol}://${request.host}/`
  const svg = await QRCode.toString(target, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#07070d', light: '#ffffff' },
  })
  return reply.type('image/svg+xml').send(svg)
})

app.register(async (scope) => {
  scope.get('/ws', { websocket: true }, (socket) => {
    const s = socket as unknown as Socket
    sockets.set(s, {})
    sendTo(s, snapshot())

    socket.on('message', (raw: Buffer) => {
      void (async () => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(raw.toString()) as Record<string, unknown>
        } catch {
          return
        }
        const meta = sockets.get(s)
        if (!meta) return

        switch (msg.type) {
          case 'join': {
            const address = String(msg.address ?? '') as Address
            if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return
            meta.address = address
            join(address, String(msg.name ?? 'anon'), Number(msg.avatar ?? 0))
            sendTo(s, snapshot(address))
            break
          }
          case 'bet': {
            if (!meta.address) return sendTo(s, { type: 'error', code: 'NOT_JOINED' })
            const result = await bet(
              meta.address,
              Number(msg.side) === 1 ? 1 : 0,
              Number(msg.stake ?? 0),
              Number(msg.nonce ?? 0),
              String(msg.sig ?? '') as Hex,
            )
            sendTo(s, result.ok ? { type: 'bet_ok', staked: result.staked } : { type: 'error', code: result.code })
            break
          }
          case 'camera': {
            // only the projector sends this, and only with the operator key
            if (msg.key !== env.OP_KEY) return
            cameraUpdate(Number(msg.total ?? 0), Number(msg.visible ?? 0))
            break
          }
          case 'resync': {
            sendTo(s, snapshot(meta.address))
            break
          }
          default:
            break
        }
      })()
    })

    socket.on('close', () => sockets.delete(s))
    socket.on('error', () => sockets.delete(s))
  })
})

// --- operator panel: every command is guarded by OP_KEY ---------------------------------

function guard(request: { query: unknown }): boolean {
  return (request.query as { k?: string } | undefined)?.k === env.OP_KEY
}

app.post('/op/open', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  const kind = (request.query as { kind?: string }).kind === '1' ? 1 : 0
  await openRound(kind)
  return { ok: true }
})

app.post('/op/resume', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  resume()
  return { ok: true }
})

app.post('/op/freeze', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  await freezeNow()
  return { ok: true }
})

app.post('/op/settle', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  await settle()
  return { ok: true }
})

app.post('/op/payout', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  const result = await payout()
  return { ok: true, ...result }
})

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api') || request.url.startsWith('/op')) {
    return reply.code(404).send({ error: 'not found' })
  }
  return reply.sendFile('index.html')
})

startPricePolling()
startLoop()

await app.listen({ port: env.PORT, host: '0.0.0.0' })
log.info({ port: env.PORT, contract }, 'auramaxx server up')
