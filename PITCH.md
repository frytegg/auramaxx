# AURAMAXX — PITCH.md, the technical annex

`RUNSHEET.md` is the 3-minute show for the room. **This is what you say after it, for the jury**
(judges are 50% of the vote), and what you answer in Q&A. Target: **40 seconds spoken**, the rest
is ammunition.

> **Rule: every number here is measured today or it does not get said.** Placeholders in `«…»`
> must be filled from a real receipt or a real measurement before you go on stage. An unverified
> number in front of engineers costs more than saying nothing.

---

## The 40-second version

> "Four things under the hood.
> **One** — the pricing is a parimutuel in pure integer arithmetic. Odds are pool balances, they
> sum to exactly 10000 basis points by construction, the house takes zero, and my address is
> blocked from betting in the constructor.
> **Two** — that last round was an oracle. A camera counts the lit phones, the number goes on
> chain, and the contract computes the threshold itself so I can't pick it. You just watched the
> room attack it.
> **Three** — one transaction paid «N» people in «X» milliseconds for «G» gas. That's the whole
> room settled inside a single block.
> **Four** — the video path is HDMI into a capture card into the browser, «F» frames a second of
> detection in about half a millisecond a frame, with no machine-learning model at all.
> It's all verified on Sourcify, the repo is public, and every number on that screen is real."

---

## Pillar 1 — Pricing maths

- **Parimutuel**, the tote board: all stakes in one pot, split pro rata among the winning side.
- Implied odds `pool[i] * 10000 / total`, which **sums to exactly 10000** by integer division —
  no fixed-point library, no floating point, no rounding drift.
- Payout `stake * total / pool[winner]`, multiplying before dividing.
- **Invariant:** `sum(payouts) <= total`. Dust stays in the contract, never overpays.
- Edge cases handled explicitly: one-sided pool refunds everyone rather than dividing by zero;
  a replayed nonce is rejected; a malformed entry in a batch **clamps instead of reverting**, so
  one bad bet cannot destroy the other nineteen in the same transaction.
- **The house takes 0% and cannot bet.** `cannotTrade[operator]` is set in the constructor —
  three lines you can read on the verified source.

*Say it as:* "I take no position, I can't win this, and the odds aren't a chart I drew — they're
the pool balances, repricing every 302 milliseconds."

## Pillar 2 — The oracle, and the attack

**The measurement that earns this section.** We tested every BTC feed on Monad testnet this
morning: RedStone reverts on a stale-timestamp error, Pyth's BTC price was **29 hours old**, and
Stork — the only live one — **updated once in two minutes** (81,322.74 → 81,340.09, after 105
seconds frozen). A 30-second round therefore has about a 1-in-3 chance that the on-chain price
moves at all. So we read Binance in the backend and push both prices at settle, and we say so.

*Say it as:* "Round one uses an oracle I control — you have to trust me. Round two, the oracle is
you. Neither of those is how you'd do it with real money, and that's the whole point of the
demo."

- A physical sensor writes a number to a blockchain. That is the oracle problem, live.
- The camera counts; the **contract** computes `line = ceil(nBettors / 2)` and resolves. The
  operator supplies data, never the threshold.
- **Bets lock before the action window opens**, enforced server-side. Without that ordering the
  round is meaningless.
- **Two independent counts on screen:** the camera's, and the backend's tally of LIGHT UP taps
  over the WebSocket. If they disagree, we say so out loud. Measured tonight: camera «C» vs
  server «S».
- And then the room manipulated it — which is the point. *"You didn't predict that number, you
  bought it."*

*If asked what you'd change for real money:* "Multiple independent sensors, a commit before the
window, and a dispute period. One camera run by the person who profits is exactly the design you
should never trust — which is why I demoed the attack instead of hiding it."

## Pillar 3 — Chain usage, and the Monad-specific engineering

- **One transaction pays the entire room.** «N» winners credited in one call, «G» gas, landing in
  «X» ms. `resolveChunk` exists as the safety valve against the 30M per-transaction ceiling.
- **Every bet is the player's own signature** (EIP-191), relayed by our backend. We pay the gas;
  we cannot forge a bet. No wallet, no seed phrase, no tokens for the user.
- **Phones never touch an RPC.** The backend makes a constant handful of calls per second whether
  3 or 80 people play — which is what makes a room behind one NAT survivable at all.

Decisions forced by Monad specifically, each worth a sentence if a judge digs:

| Monad behaviour | What we did |
|---|---|
| Gas charged on the **limit**, no refund | Every limit hardcoded from a real receipt, batches sized `base + perItem·n`. Measured live today: a 60,000-limit call charged exactly 60,000 |
| `block.timestamp` has 1-second granularity, 3-4 blocks share one | All timing in `block.number` |
| Reserve balance: value spends below 10 MON revert; gas is budgeted separately | Relayer pays gas only, never delegated via 7702 (a delegated EOA under 10 MON reverts on everything) |
| `eth_getLogs` capped at 100 blocks ≈ 30 s of history | State rehydrates from view calls through Multicall3, never from logs — so we can redeploy the backend mid-event without losing the room |
| `eth_maxPriorityFeePerGas` hardcoded at 2 gwei, real median ~8 | Tip set explicitly, or we sort to the bottom of the block and a fast chain looks slow |
| `eth_sendRawTransactionSync` returns a receipt in ~25 ms warm | Used for the confirmation tick, with the async poll path as fallback |

*Honest line, say it before anyone says it for you:* "Eighty people tapping is about four
transactions a second. That is not a throughput story and I won't pretend it is. What this chain
gives me is one transaction big enough to pay the whole room, landing in a third of a second."

## Pillar 4 — The video pipeline

- GoPro HERO7 → micro-HDMI → USB capture (UVC) → `getUserMedia` in Chrome. No vendor software, no
  virtual camera, no driver. Fallback is the laptop's own camera on the **same code path** —
  one keystroke swaps the input.
- Detection: each frame drawn into a 320×180 offscreen canvas, one `getImageData`, **~0.5 ms per
  frame**, around 2% of a 30 fps budget.
- The metric is `score = min(R,B) − G`. Magenta scores ~229, white 0, skin ~−67, a green exit sign
  ~−200. **Magenta specifically because nothing in a room is magenta** — and French exit signs
  are permanently-lit green, which rules green out.
- **Reference subtraction:** the mask is snapshotted at bet-lock, so only lights that *appeared*
  are counted. That is what makes it survive both a daylit room and a dimmed one.
- Then two-pass connected components, minimum blob area ~6 px.
- **No neural network, nothing downloaded at runtime** — about 60 lines of canvas 2D.

*Why not a model?* "We measured it. Browser person-detectors got 4 to 26 people in a crowded room
of about 100, zero in a dimmed one, and the answer moved 2 to 4× just by dragging the confidence
slider. An oracle whose output depends on a slider isn't an oracle. A lit screen needs four pixels
to be detected; a face needs forty to be recognised."

---

## Numbers to capture during the build

Fill these in as they happen. Nothing goes on stage unfilled.

- [ ] Contract address + Sourcify verification link: «…»
- [ ] Measured `eth_sendRawTransactionSync` round trip **on the venue network**: «…» ms
- [ ] Charged gas for `betBatch` with n bets (balance delta, not `estimateGas`): «…»
- [ ] Biggest resolve of the night: «N» paid, «G» gas, «X» ms, tx `«0x…»`
- [ ] Total rounds and total bets by demo time: «…»
- [ ] Camera count vs backend tally in the final round: «C» vs «S»
- [ ] Detection frame rate and per-frame cost: «F» fps, «…» ms

## Likely jury questions

**"Is this gambling?"** No purchase, no withdrawal, no cash value — the contract issues the AURA
and they stay in it. It's a tote board with play money.

**"What's on chain and what isn't?"** On chain: AURA, pools, odds, every bet as a signed
message, and the payouts. Off chain: the WebSocket transport, the camera, and the operator UI.
The backend cannot forge a bet, because each one carries the player's signature.

**"Could this scale?"** The binding constraint isn't the chain, it's the room — a single resolve
is bounded by the 30M per-transaction gas ceiling, which is why `resolveChunk` exists. Beyond a
few hundred players you'd chunk payouts or switch to a claim model, and lose the visual moment
that makes this work.

**"What if two phones are 30 cm apart at the back?"** They can merge into one blob. That's why
this resolves a binary with a threshold rather than an exact count — the error budget is designed
in, and the backend tally sits beside it as a cross-check.

**"Why no VRF / randomness?"** Nothing here needs it, and on Monad `PREVRANDAO` is derived from
the leader's signature, so the leader knows it in advance. Pyth Entropy costs 0.128 MON per
request and takes 0.9 to 3 seconds. A physical coin flip on stage is faster and unimpeachable.

**"Is the camera recording us?"** No. It's my camera, into my laptop, and there is no
`MediaRecorder` anywhere in the code — only a number leaves the machine. I announce that before
the round.

**"What breaks first under load?"** The public RPC, at about 50 requests a second per IP shared
by the whole room. That's why phones never call it and the backend's call rate is flat in the
number of players.

## What we deliberately did not build, and why

Person detection (unreliable, measured). Public camera feeds (cross-origin pixels are unreadable,
and the audience's own stream can run ahead of the projector). On-chain tick streams (99 tx per
round to render network jitter as drama). Commit-reveal verified by our own server (circular).
A proxy or upgradeable contract (state loss is free here — it's play money). Wallet connect
(20-40 seconds per person × 80 people is the difference between a room joining and a room giving
up).

Each of those is a way to lose at 17:00, and the cut list was written before the first line of
code.
