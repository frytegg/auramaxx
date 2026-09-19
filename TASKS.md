# AURAMAXX — build day tasks

**Fixed clock:** code freeze **18:00** · submit **as early as possible** (pitch order = submission
order) · demos ~18:30 · **3 minutes on stage**.

**Owners:** **A** = Alex · **M** = Martin (UI/UX) · **C** = Claude (contracts + backend).

---

## Already done before any code

- [x] Funding: **4,636 MON** on `0x96455C9b…328b1Dd`, **30 MON** on the relayer
      `0xe2b2d6C6…EA74d0` (key in `server/.env`, gitignored). Recovered from the ETHDenver pools
      by swapping worthless mockUSDC through the AMMs — `resetPool` was absent from the deployed
      bytecode.
- [x] Gas model verified live: a 60,000-limit call was charged exactly 60,000.
- [x] BTC oracles tested on testnet: RedStone reverts, Pyth 29 h stale, Stork alive but updates
      only every ~105 s → **backend is the oracle for Q1** (Binance, pushed at settle).
- [x] Spec v3, pitch, runsheet, CLAUDE.md written. All decisions in `SPEC.md §15`.

---

## Now → 12:30 · foundations (C)

- [ ] **First commit** of the docs — the public repo is our proof the work was done today
- [ ] `foundryup` (local Foundry was 1.7.1; Monad support needs >= 1.8.3)
- [ ] pnpm workspace `contracts/ server/ web/`, zod env validation, deploy a two-line `Ping`
      contract and verify it on Sourcify **before** anything depends on that pipeline
- [ ] Measure the real `eth_sendRawTransactionSync` round trip **on the venue Wi-Fi** — that
      measured number is the only one allowed on the projector
- [ ] Measure charged gas as a **balance delta** for a batch call, and derive cost per player

## 12:30 → 14:00 · `Auramaxx.sol` (C)

- [ ] Rounds (kind: price / magenta), `commitBatch` with per-player stake cap
      `1000 − alreadyStaked`, `resolveByPrice`, `resolveByCount` with the 45% threshold,
      `resolveChunk`, `payoutMon`, view functions for rehydration
- [ ] Payout maths exactly as `pari_formules.pdf` — multiply before divide, empty winning pool
      refunds, dust to `faucetReserve`
- [ ] Five forge tests only: multipliers sum correctly · pro-rata payout with no dust left ·
      one-sided pool refunds · replayed nonce rejected · stake above the remaining balance
      clamped · a bad entry in a batch does not kill the other nineteen
- [ ] Deploy + verify, record the address. Redeploy freely — it is play money, no proxy
- [ ] **CUT LINE 14:00:** drop `resolveChunk` and `payoutMon` chunking if not done

## 14:00 → 15:00 · backend spine (C)

- [ ] WS hub, signature checks, one relayer with local nonce, **hardcoded gas limits from real
      receipts**, 10 Hz broadcast, snapshot on connect/reconnect, gas burn counter
- [ ] Round state machine on **block numbers**: open → reveal ⅓ → reveal ⅔ → freeze → settle.
      Counts **not sent at all** while hidden
- [ ] Binance poller for Q1, snapshot at open and freeze
- [ ] Custodial wallet per player at join
- [ ] **Deploy to Railway now, not later** (locally-hosted = disqualified)
- [ ] Green when: a bet sent by `curl` lands on chain and prints a block number, twice running

## When A is back with the cable · **GoPro test** (A + C, ~20 min, parallel with the build)

- [ ] GoPro → micro-HDMI → capture dongle → laptop USB 3. HyperSmooth **OFF**, Linear, 1080p,
      **never recording**, Auto Power Off Never, USB power
- [ ] It appears in Chrome: `webrtc.github.io/samples/src/content/devices/input-output/`
- [ ] **The magenta test:** several phones at full brightness on `#FF00E5`, held at 3 m, 8 m,
      12 m. Check: clearly pink, **two phones 30 cm apart stay separate blobs**, nothing else in
      the room reads magenta. Once with the lights on, once dimmed
- [ ] Calibrate `RADIUS` for MODE A and the detection threshold
- [ ] **If it fails: laptop webcam turned toward the room.** Same code path, one keystroke. Do not
      buy anything, do not lose more than 20 minutes on this

## 15:00 → 16:00 · phone + projector (C, design from M)

- [ ] Phone: avatar + first name, side buttons, the four stake buttons capped at remaining,
      hidden/revealed counts, magenta full-screen with wakeLock, personal result card
- [ ] Projector: **build the payout flash first** — it is the demo. Then counters, multipliers,
      names, camera view with the live tick counter
- [ ] Snapshot on reconnect, resync on `visibilitychange`, heartbeat, backoff
- [ ] Test on a real phone **over 4G with Wi-Fi off**

## 16:00 → 16:30 · camera detection (C)

- [ ] `getUserMedia` with `ideal` constraints only, `C` cycles inputs, `V` kills video
- [ ] MODE A: blob sources, 13-block cooldown, smoothing, expiry. MODE B on `T`
- [ ] Stall watchdog → auto fallback

## >>> **16:30 — DEMO READY. Screen-record a full run immediately.** <<<

Both questions, real phones, real payout, real hash. That recording is the difference between a
bad demo and no demo.

Cut order if not green: wallet export → avatar dance → MODE B polish → reveal animations.
**Never cut:** the payout flash, the leaderboard, the MON transaction.

## 16:30 → 17:15 · room test + submit (A, M, C)

- [ ] Get 15-25 other hackers to scan the QR and play two real rounds. Real load, real Wi-Fi,
      real names on the board, and the camera threshold tuned for the actual lighting
- [ ] **SUBMIT** on the portal: public repo, **live Railway URL**, image, description. Early
      submission = early pitch = fresher room

## 17:15 → 18:00 · harden and rehearse (A + M)

- [ ] Fix whatever the room test broke; wire the RPC failover to Ankr (DNS dropped twice today)
- [ ] Re-record the backup video after polish
- [ ] **Rehearse twice with a stopwatch at 3 minutes.** Martin on `/op` (rounds, reveals, freeze,
      `T` if the counter runs away), Alex on the microphone
- [ ] Top up the relayer, laptop on phone hotspot, `Win+P` → **Extend**, test the projector cable

## **18:00 FREEZE** · demos ~18:30

---

## Deferred on purpose

- **Avatars and the goofy/funny features** — discussed when backend and frontend are linked (M).
  Word is that everyone is riding the Blitz brainrot wave, so we need a visual identity that is
  ours. We already stand out technically; this is the other half.
- Stork as an on-screen cross-check for Q1, if there is time.

## Standing rules

- Gas measured as a **balance delta**, never `estimateGas`, never forge numbers.
- Never render a block number, hash or count that is not real.
- `git status` before every commit — the repo is public, the relayer key is not.
- Anything not on this list is not being built today.
