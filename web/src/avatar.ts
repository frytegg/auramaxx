/**
 * The lobby mascot: a cartoon humanoid looping two meme dances while sliding across the stage.
 * Hand-authored SVG with a nested-group skeleton, driven by one requestAnimationFrame loop.
 *
 * Why not a 3D avatar. three.js plus a rigged GLB plus Mixamo clips is several megabytes over
 * venue wifi, on a page whose whole job is to be on screen instantly when the room walks in. A
 * vector character is a few KB, stays sharp at any projection size and cannot fail to load.
 * Cartoons were 2D long before they were cheap to render.
 *
 * The head is a photograph of Martin, used with his permission, clipped to the head ellipse and
 * carrying a light cartoon pass. Everything below the neck stays flat vector, which is the look
 * the whole thing is going for anyway.
 *
 * Rigging note. Every joint uses SVG's own `rotate(deg, cx, cy)`, which takes the pivot
 * explicitly, so nothing depends on CSS `transform-origin` — whose behaviour on SVG elements is
 * the usual reason limbs fly off across browsers. Groups nest the way a skeleton does, so a
 * rotated shoulder carries its forearm and hand for free.
 */

import { MARTIN_FACE } from './face.js'

// --- the skeleton. The markup and the animation read these, so they cannot disagree. ---------

const NECK: Pivot = [110, 116]
const HIP: Pivot = [110, 200]
const SHOULDER_L: Pivot = [82, 130]
const SHOULDER_R: Pivot = [138, 130]
const ELBOW_L: Pivot = [82, 176]
const ELBOW_R: Pivot = [138, 176]
const HIP_L: Pivot = [97, 200]
const HIP_R: Pivot = [123, 200]
const KNEE_L: Pivot = [97, 256]
const KNEE_R: Pivot = [123, 256]

type Pivot = readonly [number, number]

const SKIN = '#F0B08A'
const SUIT = '#2E4D80'
const SUIT_DARK = '#20375C'
/** Sleeves are deliberately a shade off the jacket. Matched exactly, the arms vanish into the
 *  chest and the character reads as a man with no arms waving two floating hands. */
const SLEEVE = '#3C639F'
const TIE = '#1C2A47'
const SHIRT = '#F8F3F7'
const MAGENTA = '#FF2E9E'
const INK = '#0B0710'
/** One cartoon outline on every part. This, more than any colour choice, is what makes a limb
 *  legible from the back of a room when it crosses the body. */
const LINE = 'stroke="#08060E" stroke-width="3.5" stroke-linejoin="round"'

/** A limb: a rounded bar from its pivot downwards, which every rotation then swings. */
function bar(pivot: Pivot, length: number, width: number, fill: string): string {
  return `<rect x="${pivot[0] - width / 2}" y="${pivot[1] - width / 2}" width="${width}" height="${length + width}" rx="${width / 2}" fill="${fill}" ${LINE} />`
}

let mounted = 0

function markup(uid: string): string {
  return `
<!-- The viewBox is cropped tight to the character on purpose. On screen his height works out to
     (container width x 299 / viewBox width), so for a fixed slot in the page layout only the
     viewBox HEIGHT sets how big he looks — the width just buys travel. -->
<svg id="ax-svg" viewBox="0 14 620 334" role="img" aria-label="A dancing mascot">
  <defs>
    <radialGradient id="ax-glow-${uid}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${MAGENTA}" stop-opacity=".30" />
      <stop offset="100%" stop-color="${MAGENTA}" stop-opacity="0" />
    </radialGradient>
  </defs>

  <g id="ax-slide">
    <ellipse id="ax-shadow" cx="110" cy="336" rx="52" ry="11" fill="${INK}" opacity=".45" />
    <ellipse cx="110" cy="190" rx="150" ry="160" fill="url(#ax-glow-${uid})" />

    <g id="ax-bob">
      <g id="ax-lean">

        <!-- legs first: the torso and arms draw over them -->
        <g id="ax-legL">
          ${bar(HIP_L, 56, 23, SUIT)}
          <g id="ax-shinL">
            ${bar(KNEE_L, 52, 19, SUIT_DARK)}
            <ellipse cx="${KNEE_L[0] - 2}" cy="${KNEE_L[1] + 56}" rx="16" ry="10" fill="${SUIT_DARK}" ${LINE} />
          </g>
        </g>
        <g id="ax-legR">
          ${bar(HIP_R, 56, 23, SUIT)}
          <g id="ax-shinR">
            ${bar(KNEE_R, 52, 19, SUIT_DARK)}
            <ellipse cx="${KNEE_R[0] + 2}" cy="${KNEE_R[1] + 56}" rx="16" ry="10" fill="${SUIT_DARK}" ${LINE} />
          </g>
        </g>

        <g id="ax-torso">
          <!-- jacket: shoulders wider than hips, the cheapest way to read as a suit -->
          <path d="M 76,140 Q 76,120 98,117 L 122,117 Q 144,120 144,140 L 140,204 L 80,204 Z" fill="${SUIT}" ${LINE} />
          <path d="M 98,117 L 110,158 L 122,117 Z" fill="${SHIRT}" />
          <path d="M 110,126 L 118,140 L 110,182 L 102,140 Z" fill="${TIE}" stroke="#08060E" stroke-width="2" />
          <circle cx="110" cy="148" r="2.3" fill="${MAGENTA}" />
          <circle cx="110" cy="160" r="2.3" fill="${MAGENTA}" />
          <circle cx="110" cy="172" r="2" fill="${MAGENTA}" />
          <circle cx="99" cy="147" r="3.4" fill="${MAGENTA}" stroke="#08060E" stroke-width="1.6" />
          <path d="M 98,117 L 110,158 L 96,150 Z" fill="${SUIT_DARK}" />
          <path d="M 122,117 L 110,158 L 124,150 Z" fill="${SUIT_DARK}" />

          <g id="ax-armL">
            ${bar(SHOULDER_L, 46, 20, SLEEVE)}
            <g id="ax-foreL">
              ${bar(ELBOW_L, 40, 18, SLEEVE)}
              <circle cx="${ELBOW_L[0]}" cy="${ELBOW_L[1] + 38}" r="10" fill="${SHIRT}" ${LINE} />
              <circle cx="${ELBOW_L[0]}" cy="${ELBOW_L[1] + 48}" r="13" fill="${SKIN}" ${LINE} />
            </g>
          </g>
          <g id="ax-armR">
            ${bar(SHOULDER_R, 46, 20, SLEEVE)}
            <g id="ax-foreR">
              ${bar(ELBOW_R, 40, 18, SLEEVE)}
              <circle cx="${ELBOW_R[0]}" cy="${ELBOW_R[1] + 38}" r="10" fill="${SHIRT}" ${LINE} />
              <circle cx="${ELBOW_R[0]}" cy="${ELBOW_R[1] + 48}" r="13" fill="${SKIN}" ${LINE} />
            </g>
          </g>

          <g id="ax-head">
            <clipPath id="ax-face-${uid}">
              <ellipse cx="${NECK[0]}" cy="72" rx="44" ry="48" />
            </clipPath>
            <image href="${MARTIN_FACE}" x="66" y="24" width="88" height="96"
                   preserveAspectRatio="none" clip-path="url(#ax-face-${uid})" />
            <ellipse cx="${NECK[0]}" cy="72" rx="44" ry="48" fill="none" ${LINE} />
          </g>
        </g>

      </g>
    </g>
  </g>
</svg>`
}

// --- the two dances ------------------------------------------------------------------------

type Pose = {
  lean: number
  torso: number
  head: number
  armL: number
  armR: number
  foreL: number
  foreR: number
  legL: number
  legR: number
  shinL: number
  shinR: number
  bob: number
  squash: number
}

/** Snappier than a sine: reaches the extremes fast and lingers, which is how a beat feels. */
function snap(x: number): number {
  const s = Math.sin(Math.PI * x)
  return Math.sign(s) * Math.abs(s) ** 0.55
}

/**
 * "6-7": both palms up in front, alternating like a pair of scales, one beat each way, on a
 * bounce.
 *
 * The elbows have to be held WIDE. With the upper arms hanging near vertical, forearms at ±140°
 * both converge on the centre line and the two hands sit on top of each other — which is what
 * the first version did. Swinging the shoulders out to ±25° puts each hand above its own elbow.
 */
function sixSeven(beat: number): Pose {
  const s = snap(beat)
  const bounce = Math.abs(Math.sin(Math.PI * beat))
  return {
    lean: 5 * Math.sin((Math.PI * beat) / 4),
    torso: 4 * s,
    head: -7 * s,
    armL: 25 + 5 * s,
    armR: -25 + 5 * s,
    // 165 not 140: at 140 the forearms angle inward and the two hands meet over the tie, which
    // reads as clutching a handbag rather than holding two palms up
    foreL: -(165 + 40 * s),
    foreR: 165 - 40 * s,
    legL: -3 * s,
    legR: -3 * s,
    shinL: 4 * bounce,
    shinR: 4 * bounce,
    bob: -9 * bounce,
    squash: 1 - 0.05 * bounce,
  }
}

/**
 * The aura-farming strut: one arm sweeps out while the other drops, hips and shoulders counter
 * each other, weight shifting left to right. Slower and heavier than the 6-7, on purpose —
 * the whole joke of aura farming is refusing to hurry.
 */
function auraFarm(beat: number): Pose {
  // half tempo: the entire joke of aura farming is refusing to hurry while everything else moves
  const s = Math.sin((Math.PI * beat) / 2)
  const bounce = Math.abs(Math.sin(Math.PI * beat))
  return {
    lean: 11 * s,
    torso: -14 * s,
    head: 12 * s,
    // arms held permanently wide — that spread stance IS the pose; the sway only rocks it
    armL: 46 + 30 * s,
    armR: -46 + 30 * s,
    foreL: -(28 + 26 * s),
    foreR: 28 - 26 * s,
    legL: -9 * s,
    legR: -9 * s,
    shinL: 14 * Math.max(0, s),
    shinR: 14 * Math.max(0, -s),
    bob: -5 * bounce,
    squash: 1 - 0.03 * bounce,
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function blend(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose
  for (const key of Object.keys(a) as Array<keyof Pose>) out[key] = lerp(a[key], b[key], t)
  return out
}

/** 0 -> 1 with flat ends, so a dance change eases instead of snapping. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// --- the loop ------------------------------------------------------------------------------

const BEAT_MS = 462 // ~130 BPM
const BARS = 16 // beats per full round trip: 8 of one dance, 8 of the other
const SLIDE = 165 // how far it travels either side of centre
const BASE_X = 200 // the character is drawn near x=110; this centres it in the 620-wide stage
const FEET = 330 // squash and stretch has to happen about the floor, not about the SVG origin

export type Mascot = { start: () => void; stop: () => void }

/** A mounted character whose joints can be driven directly. Separated from the loop so poses can
 *  be rendered one at a time for inspection, rather than only ever flashing past at 130 BPM. */
export type Rig = { apply: (pose: Pose, x: number) => void }

export const DANCES = { sixSeven, auraFarm }
export { blend }
export type { Pose }

export function mountRig(host: HTMLElement): Rig {
  host.innerHTML = markup(String(++mounted))

  const node = (id: string): SVGGraphicsElement => host.querySelector(`#${id}`) as SVGGraphicsElement
  const slide = node('ax-slide')
  const bob = node('ax-bob')
  const lean = node('ax-lean')
  const torso = node('ax-torso')
  const head = node('ax-head')
  const armL = node('ax-armL')
  const armR = node('ax-armR')
  const foreL = node('ax-foreL')
  const foreR = node('ax-foreR')
  const legL = node('ax-legL')
  const legR = node('ax-legR')
  const shinL = node('ax-shinL')
  const shinR = node('ax-shinR')
  const shadow = node('ax-shadow')

  const rotate = (el: SVGGraphicsElement, deg: number, p: Pivot): void => {
    el.setAttribute('transform', `rotate(${deg.toFixed(2)},${p[0]},${p[1]})`)
  }

  return {
    apply: (pose: Pose, x: number): void => {
      slide.setAttribute('transform', `translate(${x.toFixed(2)},0)`)
      bob.setAttribute(
        'transform',
        `translate(0,${pose.bob.toFixed(2)}) translate(0,${FEET}) scale(1,${pose.squash.toFixed(3)}) translate(0,${-FEET})`,
      )
      // the shadow tightens as he lifts off it, which is what actually sells the bounce
      shadow.setAttribute('rx', (52 + pose.bob * 0.9).toFixed(1))
      shadow.setAttribute('opacity', (0.45 + pose.bob * 0.012).toFixed(3))

      rotate(lean, pose.lean, HIP)
      rotate(torso, pose.torso, HIP)
      rotate(head, pose.head, NECK)
      rotate(armL, pose.armL, SHOULDER_L)
      rotate(armR, pose.armR, SHOULDER_R)
      rotate(foreL, pose.foreL, ELBOW_L)
      rotate(foreR, pose.foreR, ELBOW_R)
      rotate(legL, pose.legL, HIP_L)
      rotate(legR, pose.legR, HIP_R)
      rotate(shinL, pose.shinL, KNEE_L)
      rotate(shinR, pose.shinR, KNEE_R)
    },
  }
}

/** The pose and stage position at a given beat: 6-7 one way, aura farming back. */
export function poseAt(beat: number): { pose: Pose; x: number } {
  const u = (beat / BARS) % 1 // 0..1 across the round trip
  // rising then falling gives a flat 1 in the middle, so each dance is seen pure rather than
  // permanently half-blended into the other
  const toAura = smoothstep(0.44, 0.52, u) - smoothstep(0.94, 1.0, u)
  return {
    pose: blend(sixSeven(beat), auraFarm(beat), toAura),
    x: BASE_X - Math.cos(2 * Math.PI * u) * SLIDE,
  }
}

/**
 * Builds the mascot inside `host` and returns handles. The loop is stopped whenever the lobby is
 * off screen: a projector laptop is also running the camera detector, and this is decoration.
 */
export function mountMascot(host: HTMLElement): Mascot {
  const rig = mountRig(host)
  let raf = 0
  let startedAt = 0

  function frame(now: number): void {
    if (!startedAt) startedAt = now
    const { pose, x } = poseAt((now - startedAt) / BEAT_MS)
    rig.apply(pose, x)
    raf = requestAnimationFrame(frame)
  }

  return {
    start: (): void => {
      if (raf) return
      raf = requestAnimationFrame(frame)
    },
    stop: (): void => {
      if (!raf) return
      cancelAnimationFrame(raf)
      raf = 0
    },
  }
}
