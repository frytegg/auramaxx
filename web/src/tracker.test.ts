/**
 * Counting logic tests. Run: pnpm exec tsx src/tracker.test.ts
 * No camera, no DOM — these are the rules the room will try to break.
 */
import assert from 'node:assert/strict'
import { SourceTracker, mergeBlobs, type TrackedBlob } from './tracker.js'

const options = { radius: 10, cooldownMs: 4000, tickMs: 4000, mode: 'A' as const }
const at = (x: number, y: number): TrackedBlob => ({ x, y })
/** a blob with a real bounding box, the way the detector actually emits them */
const box = (minX: number, minY: number, maxX: number, maxY: number): TrackedBlob => ({
  x: (minX + maxX) / 2,
  y: (minY + maxY) / 2,
  minX,
  minY,
  maxX,
  maxY,
})
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

check('ONE phone waved across the room cannot farm the counter', () => {
  const t = new SourceTracker({ ...options })
  // reproduces the real bench result: one phone, wild movement, blob vanishing and reappearing
  // far away as the screen tilts. Before the rate cap this reached ~94.
  let ms = 0
  for (let sweep = 0; sweep < 12; sweep++) {
    for (let step = 0; step < 20; step++) {
      const x = 20 + ((sweep % 2 === 0 ? step : 19 - step) * 14)
      const visible = step % 3 !== 0 // the screen angles away every third frame
      t.ingest(visible ? [at(x, 40 + (step % 5) * 9)] : [], ms)
      ms += 16
    }
  }
  const windows = Math.ceil(ms / options.cooldownMs)
  assert.ok(t.total <= windows, `one screen may score at most once per 4s window: got ${t.total} over ${windows} windows`)
  assert.ok(t.total >= 1, 'it must still count at least once')
})

check('the cap scales with the number of screens actually in the room', () => {
  const t = new SourceTracker({ ...options })
  const forty = Array.from({ length: 40 }, (_, i) => at(10 + (i % 20) * 15, 30 + Math.floor(i / 20) * 60))
  t.ingest(forty, 0)
  assert.equal(t.total, 40, '40 phones all count on the first window')
  for (let ms = 100; ms < 3900; ms += 100) t.ingest(forty, ms)
  assert.equal(t.total, 40, 'holding them up does not add more inside the window')
  // lower them properly: a flicker shorter than the 300 ms grace is not "lowered and raised"
  t.ingest([], 4100)
  t.ingest([], 4600)
  t.ingest(forty, 5000)
  assert.equal(t.total, 80, 'the next window allows another 40')
})

check('hide and re-show slightly off, inside the cooldown, still does not count', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  // the phone was moving when it vanished, and comes back 25 px away 1.5 s later
  t.ingest([at(112, 56)], 200)
  t.ingest([], 400)
  t.ingest([at(128, 64)], 1900)
  assert.equal(t.total, 1, 'the same screen, lost and found inside 4 s, is still one point')
})

check('a jerky movement does not spawn a trail of sources', () => {
  const t = new SourceTracker({ ...options })
  let ms = 0
  const path = [100, 118, 140, 120, 96, 130, 150, 128, 104]
  for (const x of path) {
    t.ingest([at(x, 50)], ms)
    ms += 60
    t.ingest([], ms) // the screen angles away between waypoints
    ms += 60
  }
  assert.equal(t.total, 1, `one phone waved for ${ms} ms inside one window: got ${t.total}`)
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

// --- what the bench actually produces: one screen arriving as several fragments -------------

check('BUG 1: a screen split by a finger counts once, not twice', () => {
  const t = new SourceTracker({ ...options })
  const fragments = [box(100, 40, 112, 70), box(116, 40, 124, 70)] // one phone, mask in two pieces
  const screens = mergeBlobs(fragments, 12)
  assert.equal(screens.length, 1, 'the two fragments are one screen')
  t.ingest(screens, 0)
  assert.equal(t.total, 1)
})

check('BUG 1: fragments that come and go while moving still count once', () => {
  const t = new SourceTracker({ ...options })
  let ms = 0
  for (let step = 0; step < 20; step++) {
    const x = 100 + step * 3
    // the split pattern changes every frame, as it does in the real mask
    const raw = step % 2 === 0 ? [box(x, 40, x + 12, 70), box(x + 16, 40, x + 24, 70)] : [box(x, 40, x + 24, 70)]
    t.ingest(mergeBlobs(raw, 12), ms)
    ms += 60
  }
  assert.equal(t.total, 1, `a single moving screen: got ${t.total}`)
})

check('BUG 2: a fragment beside a just-counted screen cannot score', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  t.ingest([at(100, 50), at(108, 50)], 60) // a second piece appears beside it, unmerged
  assert.equal(t.total, 1, 'the proximity guard holds even when merging misses')
})

check('BUG 2: hide and re-show within the cooldown, fragmented, does not count', () => {
  const t = new SourceTracker({ ...options })
  t.ingest(mergeBlobs([box(100, 40, 124, 70)], 12), 0)
  assert.equal(t.total, 1)
  t.ingest([], 500)
  t.ingest([], 1500)
  t.ingest(mergeBlobs([box(104, 42, 116, 72), box(120, 42, 128, 72)], 12), 2500)
  assert.equal(t.total, 1, `still one point: got ${t.total}`)
})

check('a one-frame flicker is not a new show', () => {
  const t = new SourceTracker({ ...options })
  t.ingest([at(100, 50)], 0)
  for (let ms = 100; ms < 9000; ms += 100) {
    // the mask drops the screen for a single frame every second, as real masks do
    t.ingest(ms % 1000 === 0 ? [] : [at(100, 50)], ms)
  }
  assert.equal(t.total, 1, `a phone held up through flicker scores once: got ${t.total}`)
})

check('two genuinely distinct screens are never merged', () => {
  const far = mergeBlobs([box(40, 40, 60, 70), box(200, 40, 220, 70)], 12)
  assert.equal(far.length, 2, 'two people apart in the room must stay two screens')
})

console.log(`\n${passed} tests passed`)
