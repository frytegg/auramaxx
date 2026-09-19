# AURAMAXX

**Bet on the room. The camera settles it.**

Built in one day at [Monad Blitz Paris](https://luma.com/wfu3ecwj), 19 September 2026, at IIM
Nanterre.

## Play it

**→ [auramaxx.onrender.com](https://auramaxx.onrender.com/)** — open it on a phone, that is the
whole game. Nothing to install.

| | |
|---|---|
| Player (phone) | <https://auramaxx.onrender.com/> |
| Projector | `/screen.html?k=<operator key>` |
| Operator console | `/regie.html?k=<operator key>` |
| Camera | `/calibrate.html?k=<operator key>` |
| Contract | [`0x0079c8A9…62910`](https://testnet.monadvision.com/address/0x0079c8A953C571f481D88195dBacC63dFE462910) on Monad testnet (chain 10143) |

The three operator pages need the key that is set in the host's environment, so it is not in this
repo. The player page needs nothing.

Two things worth knowing before you click. The backend is on a free instance that **sleeps after
15 minutes** — the first request can take half a minute to wake it, and a wake-up is a fresh
process, so the room has to rescan. And the camera page needs a **secure context**: it works over
HTTPS or on `localhost`, and a browser will refuse it on a plain-http LAN address.

A live betting game for a room full of people, on Monad testnet. You scan a QR code, pick an
avatar, type your first name, and you are playing — no wallet to install, no seed phrase, no
tokens to acquire. Everyone gets **1,000 AURA**, the game's own worthless token.

Then one question, asked twice:

**How many of you will light up?** Every phone turns magenta, a camera pointed at the room counts
the lit screens, and you bet over or under a threshold the contract computes itself from the
number of registered players.

That is the point. **You are betting on something you control — and so is everyone else.** The
room immediately works out that it can move the number, which is exactly what an oracle attack
is. That realisation, in a room of people who had never touched crypto before this weekend, is
the demo.

Betting opens with no clock, so nobody is rushed. Then the operator starts a 45-second round, and
the pools are hidden the whole way — seeing them would just make everyone queue behind whoever
bet first. Twice during the round the odds open for **five seconds**, the clock still running, and
you can throw more chips at either side. You can back OVER *and* UNDER in the same round; the
1,000 AURA caps the two together, so hedging costs real chips.

Winners are paid in **real testnet MON**, in a single transaction shown on the projector. The
more AURA you farm, the more you take home.

### The conversion rate

**100 AURA of profit = 1 MON.**

Only *profit* converts, never your balance: you are credited 1,000 fresh AURA at each question,
and what counts is the AURA you took off everyone else. Farm 1,000 AURA of profit and 10 testnet
MON land in your wallet. There is no cap — the biggest farmer of the night takes whatever they
earned.

At the end you can export your wallet's private key, so you leave with the MON and a wallet that
is genuinely yours. It is testnet: it is worth nothing in real money, and that is said out loud.

## How it works

```
phones ──signed bets over WebSocket──▶ backend (Render) ──▶ Monad testnet (chain 10143)
                                            │
projector ◀── live state, 10 Hz ────────────┘
    │
    └── USB camera ──▶ in-browser magenta detection ──▶ the count that settles round 2
```

- **Nothing on a phone ever talks to an RPC.** The backend's call rate is flat in the number of
  players, which is what makes a room behind one shared Wi-Fi work at all.
- **Every bet carries the player's own signature.** The backend relays and pays the gas; it
  cannot forge a bet.
- **The house takes 0% and cannot bet** — the operator's address is blocked in the constructor.
- **One transaction pays every winner.** At ~302 ms blocks, the whole room settles inside a
  single block.
- **The magenta detector is ~60 lines of canvas 2D.** No machine-learning model, nothing
  downloaded at runtime: `score = min(R,B) − G` on a 320×180 grid, about 0.5 ms per frame. We
  measured browser person-detectors first — 4 to 26 people found in a room of about 100 — and
  chose to count light instead of people.

## Stack

Solidity + Foundry · TypeScript · viem · fastify + WebSocket · Vite (no framework) · Monad testnet

## Documents

| File | What it is |
|---|---|
| [`SPEC.md`](SPEC.md) | the full specification, and every decision with its reason |
| [`auramaxx_paper.pdf`](auramaxx_paper.pdf) | the pricing and payout maths (parimutuel, integer-only) |
| [`PITCH.md`](PITCH.md) | the technical annex, including what we measured on testnet |
| [`TASKS.md`](TASKS.md) | the build plan, hour by hour |
| [`CLAUDE.md`](CLAUDE.md) | the Monad-specific rules the code has to respect |

## One thing we measured that is worth knowing

We started with a Bitcoin round and tested every price feed on Monad testnet that morning.
RedStone reverts on a stale timestamp, Pyth's price was **29 hours old**, and Stork — the only
live one — **updated once in two minutes**. A 30-second round therefore had roughly a
one-in-three chance of the on-chain price moving at all, which is not a game.

So the Bitcoin round was cut. What is left is the honest version of the same story: the only
oracle in this thing is a camera pointed at the room, everyone can see exactly what it measures,
and the interesting part is that they can move it.

## Local preview (demo mode, no keys needed)

`--demo` swaps the chain for an in-memory copy of the contract (same maths as `Auramaxx.sol`),
so the whole flow runs on a laptop with no relayer key, no contract and no MON.

```
cd server && pnpm install && pnpm demo      # :8080, OP_KEY = demo123
cd web && pnpm install && pnpm dev          # :5173
```

- phone: <http://localhost:5173/>
- projector: <http://localhost:5173/screen.html?k=demo123>
- operator console: <http://localhost:5173/regie.html?k=demo123>
- camera: <http://localhost:5173/calibrate.html?k=demo123>

A game is **two rounds**. From the operator console: *Start a game* on the projector puts the join
QR up, **1 · open betting** unlocks the chips on every phone with no time limit, **2 · start the
clock** runs the 45 seconds — and from there the reveals, the freeze and the settlement happen on
their own. *Back to landing* resets the projector so it can be rehearsed again.

## Licence

MIT
