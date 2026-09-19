# AURAMAXX — specification (v3, 19 Sept 2026)

**A betting game for the room, Kahoot-style.** The dashboard is on the projector, the QR code is
on the wall, and everyone plays from their phone with no install, no wallet and no tokens of
their own. Two questions. The second one is the point: **the room bets on itself**, and discovers
it can rig the result.

The AURA token has no monetary value. **Real testnet MON is paid to the winners at the end**, on chain, in one
transaction shown on the projector.

---

## 1. The show, end to end

1. QR on the projector → the phone opens the hosted web app.
2. Pick an **avatar**, type a **first name**. The name appears on the projector.
3. The account is credited with **1,000 AURA**. Nothing else to do.
4. **Question 1 — BTC up or down.** A classic bet, familiar, nobody in the room controls it. It
   teaches the gesture: choose a side, put AURA in, watch the odds move, get paid.
5. **Question 2 — magenta, over/under.** Same betting mechanics, except what they are betting on
   is **themselves**: how many lit screens the camera will count. The odds move because they
   decide to move, and the result is literally what they do.
6. Winners are credited in AURA, then the **leaderboard** appears: avatars, names, cumulative
   profit. **Top 3 on screen, their avatars dance, they are invited on stage.**
7. **Real MON is sent to the winners** and the transaction goes on the projector.

**The pitch line the contrast buys:** *"You just bet on something you don't control. Now we give
you total control — over the odds AND over the result."* That is an oracle attack, live, and a
jury gets it in one sentence.

## 2. AURA, stakes and scoring

- **1,000 AURA credited fresh at each question.** Balance does not carry over, so nobody can be
  eliminated and no recharge system is needed.
- **Free stake**, `s_i >= 1`, chosen by the player (per `auramaxx_paper.pdf §1`). Not a fixed
  amount.
- **UI: four buttons — `100` · `250` · `500` · `ALL IN`.** No keyboard, no slider: a beginner has
  10 seconds and taps a button without thinking.
- **Hard rule: a player can never stake more than what is left of their 1,000 for that question.**
  Staked 400 at the open? At a reveal the maximum is 600, `ALL IN` means 600, and the 100/250/500
  buttons are disabled above the remaining balance. Enforced server-side **and** in the contract
  (`stake <= 1000 - alreadyStaked[player][roundId]`), not only greyed out in the UI.
- The score that matters is a **separate counter: cumulative positive profit only** across the two
  questions. The leaderboard ranks that.
- **Payout in real MON:** `MON = profit_chips / 100`, i.e. 1,000 AURA of profit → 10 MON.

## 3. Round lifecycle

Same skeleton for both questions.

| t | event |
|---|---|
| 0 s | **open** — counts hidden |
| ⅓ | **REVEAL 1** — countdown pauses, counts and multipliers shown big, phones may re-bet |
| ⅔ | **REVEAL 2** — same |
| end | **FREEZE** — last state per player is what pays; settle and pay |

- **Q1: 30 s.** Reveals at 10 s and 20 s.
- **Q2: 45 s.** Reveals at 15 s and 30 s (the magenta action needs more room).
- At each reveal, show the **minority side's multiplier first** — that is the number that makes
  people move.
- **Re-betting at a reveal is ADD-ONLY** (decided): you may add to the side you already chose, or
  enter if you had not, but you can never move AURA to the other side. Otherwise the last reveal
  becomes a free ride onto the obvious winner, both pools equalise, the multiplier collapses to
  ~1.0 and nobody wins anything — the finale falls flat.
- The amount you may add is capped at `1000 − already staked this question`.

## 4. Pricing and payout — `auramaxx_paper.pdf` is authoritative

Do not re-derive these. Summary only:

- `P_up`, `P_down` = sum of stakes per side, `T = P_up + P_down`
- displayed multiplier `mult_i = T / P_i`, integer form `mult_x100 = floor(100·T / P_i)`
- before any real stake, `display_mult_i = (T+k)/(P_i+1)` with `k=2`, **cosmetic only, never
  stored**
- payout `payout_i = floor(s_i · T / P_w)`, always **multiply before dividing**, computed in
  `uint256` even when stored in `uint128`
- **empty winning pool → full refund**, explicit branch before the generic formula
- rounding dust `D = T − Σ payout_i >= 0` goes to `faucetReserve`
- invariants to test: `Σ payout ≤ T`; `n_up + n_down = N`; `P_up + P_down = T`; the winner
  calculation and the payout calculation are **independent and never mixed**

**What changed from the PDF:** §2 (winner decided by head count vs threshold θ) is **not used** in
the two-question design — Q1 is decided by the BTC price and Q2 by the camera count. Everything
else applies unchanged.

## 5. Q1 — the BTC oracle

**Measured live today on Monad testnet, do not re-litigate:**

| Oracle | Result |
|---|---|
| RedStone BTC `0xB9F0…2397` | **reverts** — stale timestamp error. Unusable. |
| Pyth `0x2880…7B43` | readable, but the price was **29 hours old**. Unusable. |
| Stork `0xacC0…4fd62`, id `keccak256("BTCUSD")` | alive: BTC $81,322.74, 18 decimals, ns timestamp. **But it updated once in 2 minutes** — 105 s stale, then +$17.35 |

A 30-second round therefore has roughly a **1-in-3 chance** that the on-chain price moves at all.
Two rounds out of three would have no winner.

**Decision: the backend is the oracle for Q1.** It polls Binance BTCUSDT (~1 Hz), snapshots the
price at open and at freeze, and submits both to the contract at settle. Displayed on screen
with its source. Say it plainly on stage — it is the first step of the oracle story, not a flaw
to hide.

Keep the Stork read as an on-screen cross-check if time allows ("the on-chain feed says X, and it
is 90 seconds old — that is why I could not use it").

## 6. Q2 — magenta, the technical core

**The bet:** over/under a threshold, **computed by the contract** from the number of players.
Bets are locked before the action starts.

**Threshold formula (decided):** `threshold = 45 × N × TICKS / 100`, where `N` = players who bet
and `TICKS = 11` (45 s ÷ 4 s cooldown). With 40 players: max theoretically 440, threshold **198**.
45% is the band where the outcome is genuinely uncertain — 30% and OVER always wins, 60% and the
room has to organise itself perfectly. **Recalibrate the 45 after the first real camera test**;
it is one constant in the contract.

**The action:** after the lock, every phone turns solid `#FF00E5`. Players hold their screen
**facing the camera**. Total window 45 s.

**The count — MODE A, position tracking (primary, decided by Alex).** Each screen shown to the
camera adds +1, then that spot goes on a 4-second cooldown. Players will be asked to spread out
in the room, which is what makes this tractable.

Algorithm, on the 320×180 detection grid:

```
sources = []                    // one entry per screen position seen recently
every frame:
  blobs = detect()              // centroids of magenta blobs
  for each blob:
     s = nearest source within RADIUS
     if none:                   // a new screen appeared
         count += 1;  sources.push({pos: blob, cooldownUntilBlock: now + 13, visible: true})
     else if !s.visible and now >= s.cooldownUntilBlock:
         count += 1;  s.cooldownUntilBlock = now + 13;  s.visible = true
     s.pos = smooth(s.pos, blob)      // follow small hand movement
  mark sources with no matching blob as visible = false
  drop sources unseen for > 10 s
```

- `RADIUS` ≈ 10 px on the 320-wide grid (roughly 25-30 cm in the room at our distance) —
  **calibrate during the room test**. Too small and hand jitter double-counts; too large and two
  neighbours merge into one source.
- Cooldown = **13 blocks (~4 s)**, counted in `block.number`, never in milliseconds.

**The known exploit, stated honestly:** moving a phone more than `RADIUS` creates a new source, so
someone waving their phone around can farm the counter. Three answers, in order: players are
asked to stay in place and spread out; the operator watches the counter and can press **`T`** to
switch to MODE B mid-round; and if the room farms it anyway, that IS the oracle attack and the
pitch line still lands — *"you just showed me why this number cannot be trusted"*.

**MODE B — tick sampling (fallback, one keystroke away).** Every 4 seconds a tick fires: count
the visible blobs, add them to the total. No identity, no tracking, no exploit, and it turns the
round into musical statues. Both modes share the same detector, so B is ~10 extra lines. Build A,
ship B as a flag.

Displayed continuously either way: "visible now: 23" and the running total.

**Detection** (unchanged, ~60 lines of canvas 2D, no model, nothing fetched at runtime):
320×180 offscreen canvas, one `getImageData` per frame (~0.5 ms), `score = min(R,B) − G`, blobs
above threshold, minimum area ~6 px, reference mask snapshotted at lock so only lights that
*appeared* count. Threshold on ↑/↓.

**Screen brightness cannot be forced.** No browser exposes it. `wakeLock` only stops the screen
sleeping. So: instruction screen on the phone before the round, and say it at the microphone.

**Risk to test with the GoPro today:** two phones 30 cm apart at 12 m may merge into one blob. If
they do, move the camera closer (4-5 m) — do not buy anything.

## 7. Surfaces

| Route | Who | Contents |
|---|---|---|
| `/` | attendees | avatar + first name, then: question, countdown, side buttons, stake input, AURA, multiplier, personal result card; during Q2 the full-screen magenta |
| `/screen` | projector | question, countdown, pools and multipliers, names tape, live camera + tick counter during Q2, payout flash, final leaderboard with dancing avatars |
| `/op?k=…` | one friend, second phone | open / reveal / freeze / settle per question, camera controls (`C` cycle input, `V` kill video, ↑/↓ threshold, manual count), gas gauge, kill switch |

## 8. Wallets and the MON payout

- The backend generates **one EOA per player** at join and holds the key (custodial). No wallet
  install, no seed phrase, nothing for the player to do.
- At the end: **one transaction** from a pre-funded distributor contract pays every winner their
  `profit/100` MON. That single transaction goes on the projector — it is the proof the money is
  real.
- **"Export my wallet" is IN** (decided): a button at the end reveals the player's private key, so
  everyone leaves with a real wallet holding real testnet MON. They learned what a wallet was
  yesterday with Trezor; tonight they own one. Show it as copyable text plus a QR, with a line
  saying it is a testnet key and worth nothing in real money.
- **No payout cap** (decided): a player who makes 3,000 AURA of profit receives 30 MON. We have
  the margin, and a big number on screen is worth more than the caution.
- **Funds available: 4,666 MON** (4,636 on `0x96455C9b…328b1Dd` + 30 on the relayer), recovered
  from the ETHDenver pools. Expect 200-400 MON of payouts per round with ~40 players, so the
  margin is roughly tenfold.

## 9. Backend

- Node 24 + TypeScript strict, fastify + WebSocket, viem >= 2.46.3, zod, pino. **Hosted on
  Railway** — a locally-hosted project is disqualified (event rule 02). Only the projector's
  Chrome tab runs on the laptop, because it reads the USB camera.
- One plain undelegated relayer EOA, local nonce, integer timeout on
  `eth_sendRawTransactionSync`, async fallback.
- Authoritative in-memory state; rehydrate from view calls (never from logs — 100-block cap).
- Toggles and stakes stay in memory during the round; **only the final state at freeze goes on
  chain**, in one batched call, then settle. Two transactions per round.
- **While counts are hidden, do not send them at all** — hiding them client-side puts them one
  DevTools tab away, and this room will look.
- Gas burn counter from the first transaction.

## 10. Contract

Storage ordering: declare the player array first (MIP-8 pages, cheaper mass payout).

```solidity
function joinBatch(address[] who, bytes32[] names, uint8[] avatars) external onlyRelayer;
function openRound(uint8 kind, uint64 freezeAtBlock, uint256 param) external onlyOp;
    // kind 0 = price, kind 1 = magenta; param = threshold for kind 1

struct Entry { address player; uint8 side; uint128 stake; uint32 nonce; bytes sig; }
function commitBatch(uint256 id, Entry[] entries) external onlyRelayer;  // clamps, never reverts

function resolveByPrice(uint256 id, int256 openPrice, int256 closePrice) external onlyOp;
function resolveByCount(uint256 id, uint32 count) external onlyOp;   // compares to stored threshold
function resolveChunk(uint256 id, uint16 from, uint16 to) external onlyOp;   // safety valve
function payoutMon(address[] winners, uint256[] amounts) external onlyOp;    // one tx, real MON

function getRoundState(uint256 id) external view returns (...);
function getPlayers(uint16 from, uint16 to) external view returns (...);
function mult(uint256 id) external view returns (uint32 upX100, uint32 downX100);
```

Signature payload, EIP-191 `personal_sign` (not EIP-712 — a domain mismatch between viem and
Solidity is a classic 60-minute hole and no voter can tell the difference):

```
keccak256(abi.encodePacked("AURAMAXX", block.chainid, address(this), roundId, player, side, stake, nonce))
```

`cannotTrade[operator]` set in the constructor: the house takes 0% and cannot bet.

## 11. Monad constraints that shape the code

See `CLAUDE.md` for the full list. The ones that change design:

- **Gas charged on the limit, no refund** → hardcode every limit from a real receipt, size
  batches `base + perItem·n`. Verified today: a 60,000-limit call was charged exactly 60,000.
- **`block.timestamp` has 1-second granularity** (3-4 blocks share one) → all timing in
  `block.number`. Cooldowns and reveal points included.
- **Reserve balance**: value spends that leave an EOA below 10 MON revert; gas is budgeted
  separately. The relayer only pays gas. **Never 7702-delegate it.** The distributor is a
  contract, so it is not subject to the EOA rule.
- **~50 req/s per IP on the public RPC**, and the venue may NAT the room → phones never touch an
  RPC; the backend's call rate is flat in the number of players.
- The venue Wi-Fi dropped DNS twice while we were funding wallets. **RPC failover to Ankr is not
  theoretical.**

## 12. Degradation ladder (runtime flags, never a rewrite)

| rung | trigger | action |
|---|---|---|
| 0 | nominal | camera + tick counting |
| 1 | wrong video input | `C` cycles devices |
| 2 | count misbehaving | ↑/↓, then manual entry; board reads **COUNTED BY: HUMAN** |
| 3 | camera dead / frozen 2 s / no `mediaDevices` | **`V`** — video gone, round settles from the typed number |
| 4-6 | RPC slow / erroring / down | batch mode → Ankr failover → queue and flush, and tell the room |
| 7 | chain unreachable | exhibition mode, board labelled, block field `—` |
| 8 | Wi-Fi dead | recorded round + phone hotspot for five volunteers |

**Never render a block number, hash or count that is not real.**

## 13. WebSocket protocol

Client → server: `join {name, avatar}`, `bet {roundId, side, stake, nonce, sig}`, `resync {lastSeq}`.

Server → client, every message carrying a monotonic `seq`:

```json
{"type":"snapshot","seq":n,"you":{"AURA":1000,"side":null,"stake":0,"profit":0,"rank":null},
 "round":{"id":1,"kind":"price","state":"open","freezeAtBlock":…,"hidden":true}}
{"type":"open","roundId":1,"kind":"price","question":"BTC up or down?","freezeAtBlock":…}
{"type":"reveal","up_count":22,"down_count":18,"mult_up_x100":236,"mult_down_x100":172}
{"type":"tick","visible":23,"total":156}
{"type":"freeze","roundId":1}
{"type":"resolved","roundId":1,"winner":"UP","paid":22,"txHash":"0x…","blockNumber":…,
 "settleMs":540,"you":{"delta":+340,"profit":340,"rank":5}}
{"type":"leaderboard","top":[…],"you":{…}}
{"type":"payout","txHash":"0x…","totalMon":"312.4","winners":22}
{"type":"error","code":"CLOSED|BAD_SIG|BROKE|TOO_LATE"}
```

Snapshot on every connect and reconnect, never a delta. iOS Safari suspends sockets on
background, and voters will background the app.

## 14. Non-goals

No wallet connect. No real-money gambling (AURA has no monetary value; MON is testnet). No
NFTs. No AI. No video streamed to phones. No VRF. No person detection. No proxy or upgradeable
contract. No database. No login. No markets during other teams' demos — **decision taken, we play
inside our own slot only.**

## 15. Decisions taken (19 Sept, Alex)

| # | Decision |
|---|---|
| 1 | Magenta counting: **MODE A** (position tracking, 4 s cooldown per spot). Players asked to spread out. **MODE B** (tick sampling) stays one keystroke away on `T` |
| 2 | Q2 threshold: **45% of `N × 11`** where `N` is the number of REGISTERED players, computed by the contract at freeze. Not connected players: the chain cannot see a socket, so that number would have to be submitted by the backend — which hands the operator the exact lever this design removes |
| 3 | Stake UI: **four buttons 100 / 250 / 500 / ALL IN**, capped at `1000 − already staked` |
| 4 | Reveals: **add-only**, but **both sides allowed**. Chips already down never move; new chips may go either way, and the 1,000 budget caps the two legs together, so hedging costs real chips. Each leg is paid on its own merit |
| 5 | MON payout: **no cap**, 1 MON per 100 AURA of profit |
| 6 | **"Export my wallet" is in** |
| 7 | On stage: **Alex + Martin**, one talks while the other drives `/op`. Rehearse at least once |

### Still open
- Does Martin keep §2 of the PDF (head-count resolution) anywhere, or is it fully replaced by
  price and camera? Assumed replaced.
- Avatar set (8-10 options) and the dance animation for the top 3.
- `RADIUS` for MODE A source matching, in detection-grid pixels. Calibrate live.
