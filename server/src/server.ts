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
import { currentPrice } from './price.js'
import {
  bet,
  cameraUpdate,
  freezeNow,
  join,
  leaderboard,
  newGame,
  onBroadcast,
  openRound,
  payout,
  start,
  setCount,
  settle,
  snapshot,
  startLoop,
  state,
} from './game.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = Fastify({ logger: false, trustProxy: true })

// A statically hosted front (Vercel) talks to this backend cross-origin. The game holds no
// personal data and every write is either signed by the player or guarded by OP_KEY, so a
// permissive CORS is the right trade here — but keep credentials off.
app.addHook('onRequest', async (request, reply) => {
  reply.header('access-control-allow-origin', '*')
  reply.header('access-control-allow-headers', 'content-type')
  reply.header('access-control-allow-methods', 'GET,POST,OPTIONS')
  if (request.method === 'OPTIONS') return reply.code(204).send()
  return undefined
})

await app.register(websocket)
await app.register(fastifyStatic, {
  root: path.resolve(here, '../../web/dist'),
  // wildcard:false snapshots the directory at boot, so any asset rebuilt afterwards 404s and
  // the SPA fallback returns index.html with a text/html type — the browser then parses HTML as
  // a JS module and the whole page silently does nothing. Keep it dynamic.
  wildcard: true,
  cacheControl: true,
  maxAge: 0,
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
    // a direct reply carries the current broadcast seq WITHOUT consuming one: seq tracks the
    // broadcast stream only, otherwise every private message looks like a gap to every other
    // client, they all resync, and each resync reply triggers the next storm
    socket.send(JSON.stringify({ ...(event as object), seq }))
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
            sendTo(
              s,
              result.ok
                ? { type: 'bet_ok', staked: result.staked, up: result.up, down: result.down }
                : { type: 'error', code: result.code },
            )
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

/** "Start a game" on the projector: opens the lobby the join QR belongs to. Costs no gas. */
app.post('/op/game', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  return { ok: true, ...newGame() }
})

app.post('/op/open', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  // the game is two magenta rounds: the BTC question was dropped, so every round is kind 1
  await openRound(1)
  return { ok: true }
})

app.post('/op/start', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  start()
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

/** Manual camera count, for the régie when no camera page is running (demo, or a dead camera). */
app.post('/op/count', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  const n = Math.max(0, Math.floor(Number((request.query as { n?: string }).n ?? 0)))
  setCount(n)
  return { ok: true, count: n }
})

app.post('/op/payout', async (request, reply) => {
  if (!guard(request)) return reply.code(403).send({ error: 'nope' })
  const result = await payout()
  return { ok: true, ...result }
})

app.setNotFoundHandler((request, reply) => {
  // never answer a missing asset with HTML: a 404 is loud, HTML-as-JavaScript is silent
  if (
    request.url.startsWith('/api') ||
    request.url.startsWith('/op') ||
    request.url.startsWith('/assets') ||
    /\.(js|css|map|svg|png|jpg|woff2?)$/.test(request.url)
  ) {
    return reply.code(404).send({ error: 'not found', url: request.url })
  }
  return reply.sendFile('index.html')
})

startLoop()

await app.listen({ port: env.PORT, host: '0.0.0.0' })
log.info({ port: env.PORT, contract }, 'auramaxx server up')
