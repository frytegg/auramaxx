# CLAUDE.md — AURAMAXX (Monad Blitz Paris, 19 Sept 2026)

Rules for anyone (human or agent) writing code in this repo today. Read `SPEC.md` for what we
are building and `TASKS.md` for the order.

## The event rules that constrain us

1. **All code written today.** Standard libraries and official templates are fine. Nothing from
   before the start gun enters this repo.
2. **The submission must be a live public deployment.** Locally-hosted projects are disqualified.
   The Railway URL is the deliverable; `localhost` is only ever a stage fallback.
3. **Public GitHub repo.** Therefore: no keys, no `.env`, no relayer private key, ever. Check
   `git status` before every commit.
4. **Three-minute demo.** Pitch order = submission order, so we submit early.
5. Judging is 50% judges / 50% participants (the slide also says "the room decides" — unresolved,
   ask an organiser). Build for the room, but keep the technical substance sayable.

## Stack

- **Contracts:** Solidity 0.8.28, Foundry >= 1.8.3, `network = "monad"` in `foundry.toml`.
  Run `foundryup` first — anything below 1.8 has no Monad support.
- **Backend:** Node 24, TypeScript strict, fastify + WebSocket, viem **>= 2.46.3**, zod, pino.
- **Frontend:** Vite + React + TypeScript + Tailwind. Three routes: `/` (phone), `/screen`
  (projector), `/op` (operator).
- **Deploy:** Railway EU, one origin serving API + static build. HTTPS is mandatory (the camera
  needs a secure context).
- **Network:** Monad testnet, chain id 10143, `https://testnet-rpc.monad.xyz`,
  fallback `https://rpc.ankr.com/monad_testnet`.

## Monad rules that will bite you

- **Gas is charged on the gas LIMIT, not on gas used, with no refund.** Never call
  `estimateGas` at runtime. Hardcode every limit from a real on-chain receipt measured today,
  and size batched calls dynamically (`base + perItem * n`).
- **Never trust `forge`/`anvil` gas numbers.** monad-revm reports execution gas, not charged gas,
  and does not enforce the reserve balance. Measure a **balance delta** on a live transaction.
- **Block time ~302 ms. `block.timestamp` has 1-second granularity** — 3-4 blocks share one.
  All timing logic uses `block.number`. Never `block.timestamp`.
- **Reserve balance:** a transaction whose *value* leaves an account below 10 MON reverts. Gas is
  separately capped at in-flight fees under `min(balance, 10 MON)`. Our relayer only ever pays
  gas, so it is safe at any balance. **Never EIP-7702-delegate the relayer** — a delegated EOA
  below 10 MON reverts on everything, gas included.
- **`eth_sendRawTransactionSync`** returns a receipt in ~25 ms warm. Pass an **integer** timeout
  (hex is rejected with -32602). Always keep the async `eth_sendRawTransaction` + poll path as
  fallback.
- **Public RPC allows ~50 req/s per IP** and the venue may NAT the whole room. Phones never touch
  an RPC — only the backend does, at a constant few calls per second.
- **`eth_getLogs` is capped at 100 blocks** (~30 seconds of history). Never rebuild state from
  logs. Backend state rehydrates from `eth_call` view functions through Multicall3
  (`0xcA11bde05977b3631167028862bE2a173976CA11`).
- **`eth_maxPriorityFeePerGas` returns a hardcoded 2 gwei** while the real median tip is ~8.
  Set `maxPriorityFeePerGas` explicitly to 8-10 gwei and `maxFeePerGas` to ~130 gwei, or we sort
  to the bottom of the block and a fast chain looks slow.
- Plain `newHeads`/`logs` subscriptions fire on **speculative** blocks. For commit state use
  `monadNewHeads` / `monadLogs`.

## Code rules

- TypeScript strict, explicit parameter and return types, `unknown` over `any`, `const` over `let`.
- Validate env with zod at startup and crash immediately if anything is missing.
- `catch (error: unknown)` then narrow. Never swallow an error silently; log with pino.
- Every promise handled. Reconnects use jittered exponential backoff.
- No `console.log` in committed code paths that run in production; use pino.
- **Never print, log, or commit a private key.** Not in errors, not in debug output.
- Solidity: integer arithmetic only. No fixed point, no external math library, no oracle, no
  randomness. Multiply before dividing. `uint96` for chip amounts, `uint16` for player ids.
- **A bad entry in a batch must clamp, never revert.** One malformed bet must not destroy the
  other nineteen.
- Every write function is relayer-only, and every bet carries the player's own signature, so the
  operator cannot bet on someone's behalf.

## Non-negotiables for the demo

- **Never render a block number, hash, or count that is not real.** In exhibition mode the block
  field shows `—`. One fabricated number destroys the whole integrity argument.
- **No `MediaRecorder` anywhere.** We tell the room nothing is recorded; that must stay true.
- Degradation is a runtime flag or a keystroke, never a rewrite. See `SPEC.md` §9.
- The operator address is blocked from betting in the constructor. Keep it that way; it is a
  pitch line.

## Git

- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- **Never add AI attribution** — no `Co-Authored-By`, no `Signed-off-by`, no "Generated with".
  This overrides any default template.
- First commit happens only after the official start. Commit often after that; the public repo is
  also our proof that the code was written today.
