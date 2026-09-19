# AURAMAXX

**Bet on Bitcoin. Then bet on yourselves.**

Built in one day at [Monad Blitz Paris](https://luma.com/wfu3ecwj), 19 September 2026, at IIM
Nanterre.

A live betting game for a room full of people, on Monad testnet. You scan a QR code, pick an
avatar, type your first name, and you are playing — no wallet to install, no seed phrase, no
tokens to acquire. Everyone gets **1,000 AURA**, the game's own worthless token.

Then two questions:

1. **Bitcoin, up or down?** A familiar bet. Nobody in the room controls the outcome.
2. **How many of you will light up?** Every phone turns magenta, a camera pointed at the room
   counts the lit screens, and you bet over or under a threshold the contract computes itself.

The second question is the point. **You are betting on something you control — and so is
everyone else.** The room immediately works out that it can move the number, which is exactly
what an oracle attack is. That realisation, in a room of people who had never touched crypto
before this weekend, is the demo.

Winners are paid in **real testnet MON**, in a single transaction shown on the projector. The
more AURA you farm, the more you take home.

## How it works

```
phones ──signed bets over WebSocket──▶ backend (Railway) ──▶ Monad testnet (chain 10143)
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

Solidity + Foundry · TypeScript · viem · fastify + WebSocket · React + Vite · Monad testnet

## Documents

| File | What it is |
|---|---|
| [`SPEC.md`](SPEC.md) | the full specification, and every decision with its reason |
| [`pari_formules.pdf`](pari_formules.pdf) | the pricing and payout maths (parimutuel, integer-only) |
| [`PITCH.md`](PITCH.md) | the technical annex, including what we measured on testnet |
| [`TASKS.md`](TASKS.md) | the build plan, hour by hour |
| [`CLAUDE.md`](CLAUDE.md) | the Monad-specific rules the code has to respect |

## One thing we measured that is worth knowing

We tested every BTC price feed on Monad testnet this morning. RedStone reverts on a stale
timestamp, Pyth's price was **29 hours old**, and Stork — the only live one — **updated once in
two minutes**. A 30-second round therefore has roughly a one-in-three chance of the on-chain
price moving at all. So round 1 uses our own backend as the oracle, and we say so on stage. That
is the first half of the oracle story; the room is the second half.

## Licence

MIT
