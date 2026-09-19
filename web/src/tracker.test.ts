/**
 * Counting logic tests. Run: pnpm exec tsx src/tracker.test.ts
 * No camera, no DOM — these are the rules the room will try to break.
 */
import assert from 'node:assert/strict'
import { SourceTracker, type TrackedBlob } from './tracker.js'

const options = { radius: 10, cooldownMs: 4000, tickMs: 4000, mode: 'A' as const }
const at = (x: number, y: number): TrackedBlob => ({ x, y })
let passed = 0

function check(name: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

check('a screen that appears counts once', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  assert.equal(t.total, 1)
})

check('holding it up does not keep counting', () => {
  const t = new SourceTracker({ ...options })
  for (let ms = 0; ms <= 10_000; ms += 100) t.ingest([at(100, 50)], ms)
  assert.equal(t.total, 1, 'a phone held up for 10 s is still one')
})

check('hiding and showing within the cooldown gains nothing', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  t.ingest([], 500) // lowered
  t.ingest([at(100, 50)], 1000) // raised again, 1 s later
  t.ingest([], 1500)
  t.ingest([at(100, 50)], 2000)
  assert.equal(t.total, 1, 'flashing the screen is worthless inside 4 s')
})

check('after the cooldown, showing again counts', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  t.ingest([], 1000)
  t.ingest([at(100, 50)], 4500) // past the 4 s cooldown
  assert.equal(t.total, 2)
})

check('a small hand movement is still the same screen', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  t.ingest([at(104, 53)], 200) // within the 10 px radius
  t.ingest([at(107, 55)], 400)
  assert.equal(t.total, 1)
})

check('KNOWN EXPLOIT: moving beyond the radius counts again', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  t.ingest([at(140, 50)], 200) // a metre to the left
  assert.equal(t.total, 2, 'documented: this is why the operator can switch to mode B on T')
})

check('two phones side by side are two sources', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50), at(130, 50)], 0)
  assert.equal(t.total, 2)
  for (let ms = 100; ms < 3000; ms += 100) t.ingest([at(100, 50), at(130, 50)], ms)
  assert.equal(t.total, 2, 'neither one re-counts while both stay up')
})

check('a source is forgotten after 10 s and counts as new', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  t.ingest([], 11_000)
  t.ingest([at(100, 50)], 11_100)
  assert.equal(t.total, 2)
})

check('mode B adds the visible screens on each tick', () => {
  const t = new SourceTracker({ ...options, mode: 'B' })
  t.ingest([at(1, 1), at(2, 2), at(3, 3)], 0) // first call only arms the clock
  assert.equal(t.total, 0)
  assert.equal(t.ingest([at(1, 1), at(2, 2), at(3, 3)], 4000), true)
  assert.equal(t.total, 3)
  t.ingest([at(1, 1)], 5000) // between ticks: nothing
  assert.equal(t.total, 3)
  assert.equal(t.ingest([at(1, 1), at(2, 2)], 8000), true)
  assert.equal(t.total, 5)
})

check('mode B cannot be farmed by flashing', () => {
  const t = new SourceTracker({ ...options, mode: 'B' })
  t.ingest([at(1, 1)], 0)
  for (let ms = 100; ms < 3900; ms += 100) t.ingest(ms % 200 === 0 ? [at(1, 1)] : [], ms)
  assert.equal(t.total, 0, 'only the tick matters')
  t.ingest([at(1, 1)], 4000)
  assert.equal(t.total, 1)
})

check('the operator can override the count', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  t.setTotal(42)
  assert.equal(t.total, 42, 'COUNTED BY: HUMAN')
})

console.log(`\n${passed} tests passed`)
