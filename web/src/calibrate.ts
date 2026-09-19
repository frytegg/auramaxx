/**
 * The live camera page: what the wall shows while the room lights up. The video, every screen the
 * detector sees boxed in magenta, and the count — nothing else. The calibration bench that used to
 * fill this page is still here, in a drawer behind S, so tuning never reaches the projector by
 * accident. Tuned values are saved in this browser, so a reload on stage keeps them.
 *
 * getUserMedia needs a secure context: https, or localhost. On a plain http LAN address
 * navigator.mediaDevices is simply undefined, with no error dialog — hence the explicit card.
 *
 * Nothing is recorded: frames go into a 320×180 canvas, get counted, and are thrown away. Only the
 * count ever leaves this page.
 */
import { DEFAULTS, GRID_H, GRID_W, MagentaDetector, type Options } from './detect.js'
import { linkCamera, type LinkState } from './camera-link.js'

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`#${id} is missing from calibrate.html`)
  return element as T
}

const SETTINGS_KEY = 'auramaxx.camera'
const MAGENTA = '#FF2E9E'

const video = $<HTMLVideoElement>('video')
const overlay = $<HTMLCanvasElement>('overlay')
const context = overlay.getContext('2d')
if (!context) throw new Error('2D canvas is not available')
const ctx: CanvasRenderingContext2D = context

const detector = new MagentaDetector()
let lastVisible = 0
let link: LinkState = { keyed: false, connected: false, phase: 'idle', serverCount: null, live: false }
let devices: MediaDeviceInfo[] = []
let deviceIndex = 0
let stream: MediaStream | null = null
let videoDead = false
let drawerOpen = false

// --- the "no picture" card ----------------------------------------------------------------------

function noCamera(title: string, text: string): void {
  $('nocamTitle').textContent = title
  $('nocamText').textContent = text
  $('nocam').hidden = false
}

function pictureOk(): void {
  $('nocam').hidden = true
}

window.addEventListener('error', (e) => {
  $('device').textContent = `JS error: ${e.message}`.slice(0, 110)
})
window.addEventListener('unhandledrejection', (e) => {
  $('device').textContent = `Promise rejected: ${String(e.reason)}`.slice(0, 110)
})

// --- tuned settings, remembered in this browser -------------------------------------------------------

type Tunable = 'threshold' | 'minArea' | 'weakRatio' | 'mergeRatio' | 'radius' | 'cooldownMs'
const TUNABLES: readonly Tunable[] = ['threshold', 'minArea', 'weakRatio', 'mergeRatio', 'radius', 'cooldownMs']

function loadSettings(): Partial<Record<Tunable, number>> {
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const settings: Partial<Record<Tunable, number>> = {}
    for (const key of TUNABLES) {
      const value = Number(parsed[key])
      if (parsed[key] !== undefined && Number.isFinite(value)) settings[key] = value
    }
    return settings
  } catch (error: unknown) {
    console.warn('camera: ignoring unreadable saved settings', error)
    return {}
  }
}

function saveSettings(): void {
  const settings: Partial<Record<Tunable, number>> = {}
  for (const key of TUNABLES) settings[key] = detector.options[key]
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

const saved = loadSettings()
const sliders: Array<{ input: HTMLInputElement; key: Tunable; apply: () => void }> = []

function slider(id: string, key: Tunable, label: string, format = (v: number): string => String(v)): void {
  const input = $<HTMLInputElement>(id)
  const out = $(label)
  const apply = (): void => {
    const value = Number(input.value)
    ;(detector.options as Options)[key] = value
    out.textContent = format(value)
  }
  const stored = saved[key]
  if (stored !== undefined) input.value = String(stored)
  input.addEventListener('input', () => {
    apply()
    saveSettings()
  })
  apply()
  sliders.push({ input, key, apply })
}

slider('threshold', 'threshold', 'vThreshold')
slider('minArea', 'minArea', 'vMinArea')
slider('weakRatio', 'weakRatio', 'vWeak', (v) => v.toFixed(2))
slider('mergeGap', 'mergeRatio', 'vMergeGap', (v) => v.toFixed(2))
slider('radius', 'radius', 'vRadius')
slider('cooldown', 'cooldownMs', 'vCooldown')

function restoreDefaults(): void {
  for (const { input, key, apply } of sliders) {
    input.value = String(DEFAULTS[key])
    apply()
  }
  localStorage.removeItem(SETTINGS_KEY)
  $('hint').textContent = 'Default settings restored.'
}

// --- the game ------------------------------------------------------------------------------------------

linkCamera(detector, () => lastVisible, (state) => {
  link = state
  drawStatus()
  drawLinkInfo()
})

function drawStatus(): void {
  const chip = $('status')
  let tone = ''
  let text: string
  if (!link.keyed) {
    tone = 'warn'
    text = 'Not linked to the game · add ?k= to the URL'
  } else if (!link.connected) {
    tone = 'warn'
    text = 'Reconnecting to the game…'
  } else {
    switch (link.phase) {
      case 'live':
      case 'reveal':
        tone = 'live'
        text = 'Counting live'
        break
      case 'frozen':
      case 'settling':
        tone = 'final'
        text = 'Clock stopped · settling on-chain'
        break
      case 'resolved':
        tone = 'final'
        text = 'Round settled'
        break
      case 'open':
        text = 'Bets are open · lights up at the clock'
        break
      case 'idle':
        text = 'Waiting for the next round'
        break
    }
  }
  chip.className = `status ${tone}`
  $('statusText').textContent = text
}

function drawLinkInfo(): void {
  $('linkInfo').textContent = !link.keyed
    ? 'no operator key: nothing is sent'
    : !link.connected
      ? 'disconnected, retrying'
      : link.live
        ? `live · sending ${detector.total}`
        : `connected · ${link.phase}`
}

type CounterView = { n: number; mode: 'live' | 'final' | 'warmup'; label: string; sub: string | null }

/**
 * What the big number shows. While the clock runs it is this page's own count (the one being sent).
 * Once the clock stops it is the server's count — the number that settles the round — so lights
 * that stay on afterwards can never make the wall disagree with the result.
 */
function counterView(): CounterView {
  if (link.live) return { n: detector.total, mode: 'live', label: 'Light-ups', sub: null }
  const after = link.phase === 'frozen' || link.phase === 'settling' || link.phase === 'resolved'
  if (after && link.serverCount !== null) {
    return {
      n: link.serverCount,
      mode: 'final',
      label: 'Final count',
      sub: link.phase === 'resolved' ? 'The number that settled the round' : 'Locked in · settling on-chain',
    }
  }
  return {
    n: detector.total,
    mode: 'warmup',
    label: link.keyed ? 'Warm-up · not counted yet' : 'Local count · not sent to the game',
    sub: null,
  }
}

let shownCount = -1
let shownMode = ''

function drawCounter(visible: number): void {
  const view = counterView()
  const total = $('total')
  if (view.n !== shownCount) {
    if (view.n > shownCount && shownCount >= 0 && view.mode === 'live') {
      total.classList.remove('bump')
      void total.offsetWidth // restart the animation
      total.classList.add('bump')
    }
    total.textContent = String(view.n)
    shownCount = view.n
  }
  if (view.mode !== shownMode) {
    const counter = $('counter')
    counter.classList.toggle('dim', view.mode === 'warmup')
    counter.classList.toggle('final', view.mode === 'final')
    shownMode = view.mode
  }
  $('counterLabel').textContent = view.label
  const sub = $('counterSub')
  if (view.sub === null) {
    sub.innerHTML = `<b>${visible}</b> ${visible === 1 ? 'screen' : 'screens'} on camera right now`
  } else sub.textContent = view.sub
}

// --- the camera -------------------------------------------------------------------------------------------

async function startCamera(index = 0): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    $('device').textContent = 'no mediaDevices: open this over https or on localhost'
    noCamera('The camera needs a secure page', 'Open this page over https, or on localhost. Nothing else is wrong.')
    return
  }

  // release whatever we hold before asking again: a video device is exclusive on Windows, and
  // a second page (or the Camera app) holding it gives NotReadableError with a black frame.
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  video.srcObject = null

  devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
  deviceIndex = devices.length === 0 ? 0 : ((index % devices.length) + devices.length) % devices.length
  const deviceId = devices[deviceIndex]?.deviceId

  // `ideal`, never `exact`, on width/height/frameRate: `exact` throws OverconstrainedError with
  // no prompt and no picture, which looks exactly like a broken camera on stage.
  const attempts: MediaStreamConstraints[] = [
    { video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false },
    { video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, audio: false },
    { video: true, audio: false },
  ]

  for (const [i, constraints] of attempts.entries()) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints)
      video.srcObject = stream
      videoDead = false
      // play() can reject with AbortError when the source changes quickly. That is not a reason
      // to abandon a stream that is actually fine: the frames still arrive.
      try {
        await video.play()
      } catch (playError: unknown) {
        console.warn('video.play() rejected, keeping the stream anyway', playError)
      }
      const track = stream.getVideoTracks()[0]
      const settings = track?.getSettings()
      $('device').textContent = `${track?.label || devices[deviceIndex]?.label || 'camera'} · ${settings?.width ?? '?'}×${settings?.height ?? '?'} (${devices.length} found${i > 0 ? ', fallback' : ''})`
      return
    } catch (error: unknown) {
      // release the stream we may have just taken, or the next attempt fights our own handle
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      video.srcObject = null
      const name = error instanceof Error ? error.name : String(error)
      const message = error instanceof Error ? error.message : ''
      console.error('getUserMedia failed', constraints, error)
      $('device').textContent = `camera ${name}: ${message}`.slice(0, 110)
      if (name === 'NotReadableError') {
        noCamera('The camera is busy', 'Another page or app is holding it: the Camera app, Teams, OBS or another tab. Close it, then press C.')
      } else if (name === 'NotAllowedError') {
        noCamera('Camera access was refused', 'Allow the camera from the address bar, then press C.')
      }
      await new Promise((r) => setTimeout(r, 350))
    }
  }
  $('device').textContent = `no camera after 3 attempts · ${devices.length} device(s) listed`
  if ($('nocam').hidden || $('nocamTitle').textContent === 'Waiting for the camera…') {
    noCamera('No camera found', 'Plug the camera in, then press C.')
  }
}

// --- the loop -------------------------------------------------------------------------------------------

let frames = 0
let lastFpsAt = performance.now()
let fps = 0
let lastVideoTime = -1
let frozenSince = 0

/** Where the video actually lands on screen: it is object-fit: cover, so it may overflow. */
function videoRect(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const vw = video.videoWidth || GRID_W
  const vh = video.videoHeight || GRID_H
  const scale = Math.max(w / vw, h / vh)
  return { x: (w - vw * scale) / 2, y: (h - vh * scale) / 2, w: vw * scale, h: vh * scale }
}

/** Target brackets round a screen: the room sees its own phone get picked up. */
function bracket(x: number, y: number, w: number, h: number): void {
  const arm = Math.max(6, Math.min(16, w / 3, h / 3))
  ctx.fillStyle = 'rgba(255, 46, 158, 0.14)'
  ctx.fillRect(x, y, w, h)
  ctx.beginPath()
  ctx.moveTo(x, y + arm)
  ctx.lineTo(x, y)
  ctx.lineTo(x + arm, y)
  ctx.moveTo(x + w - arm, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + arm)
  ctx.moveTo(x + w, y + h - arm)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x + w - arm, y + h)
  ctx.moveTo(x + arm, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + h - arm)
  ctx.stroke()
}

function draw(): void {
  requestAnimationFrame(draw)
  if (videoDead || video.readyState < 2) {
    drawCounter(0)
    return
  }

  // a frozen currentTime for 2 s means the capture path died: say so on the wall
  if (video.currentTime === lastVideoTime) {
    if (frozenSince === 0) frozenSince = performance.now()
    else if (performance.now() - frozenSince > 2000) {
      $('device').textContent = 'video stalled'
      noCamera('The video stalled', 'Press C to restart the camera, or V to switch it off.')
    }
  } else {
    frozenSince = 0
    lastVideoTime = video.currentTime
    pictureOk()
  }

  const result = detector.process(video, performance.now())
  lastVisible = result.visible

  const dpr = window.devicePixelRatio || 1
  const w = overlay.clientWidth
  const h = overlay.clientHeight
  if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
    overlay.width = Math.round(w * dpr)
    overlay.height = Math.round(h * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  // the detector stretches the whole frame onto its grid, so grid → screen is a plain scale
  const rect = videoRect(w, h)
  const sx = rect.w / GRID_W
  const sy = rect.h / GRID_H
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.strokeStyle = MAGENTA
  for (const blob of result.blobs) {
    let x = rect.x + blob.minX * sx
    let y = rect.y + blob.minY * sy
    let bw = (blob.maxX - blob.minX + 1) * sx
    let bh = (blob.maxY - blob.minY + 1) * sy
    // a phone at the back is a few pixels wide: give its box a size the back row can see
    const pad = 6
    const minSide = 28
    const growX = Math.max(pad, (minSide - bw) / 2)
    const growY = Math.max(pad, (minSide - bh) / 2)
    x -= growX
    y -= growY
    bw += growX * 2
    bh += growY * 2
    bracket(x, y, bw, bh)
    if (drawerOpen) {
      ctx.fillStyle = MAGENTA
      ctx.font = '600 12px "Space Grotesk", sans-serif'
      ctx.fillText(String(blob.area), x, y - 6)
    }
  }
  if (drawerOpen) {
    ctx.lineWidth = 2
    for (const source of result.sources) {
      ctx.beginPath()
      ctx.arc(rect.x + source.x * sx, rect.y + source.y * sy, detector.options.radius * sx, 0, Math.PI * 2)
      ctx.strokeStyle = source.cooling ? 'rgba(255,181,71,.9)' : 'rgba(53,226,140,.6)'
      ctx.stroke()
    }
  }

  drawCounter(result.visible)

  frames += 1
  const now = performance.now()
  if (now - lastFpsAt > 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt))
    frames = 0
    lastFpsAt = now
    // the drawer's numbers only need to be readable, not 60 Hz
    $('blobs').textContent = `${result.visible} · ${result.blobs.length}`
    $('capInfo').textContent = `+${result.visible} per ${Math.round(detector.options.cooldownMs / 1000)} s`
    $('mode').textContent = detector.options.mode === 'A' ? 'A · per spot' : 'B · per tick'
    $('perf').textContent = `${result.ms.toFixed(1)} ms · ${fps} fps`
    drawLinkInfo()
  }
}

// --- controls -------------------------------------------------------------------------------------------

function killVideo(): void {
  videoDead = true
  stream?.getTracks().forEach((t) => t.stop())
  video.srcObject = null
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  $('device').textContent = 'video killed (V)'
  noCamera('Video off', 'The round can still settle from the count typed in the régie. Press C to bring the camera back.')
}

function setDrawer(open: boolean): void {
  drawerOpen = open
  $('drawer').classList.toggle('open', open)
  document.body.classList.remove('idle-cursor')
}

function toggleFullscreen(): void {
  const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
  action.catch((error: unknown) => {
    console.warn('fullscreen refused', error)
    $('hint').textContent = 'The browser refused fullscreen. Press F11 instead.'
  })
}

const actions: Record<string, () => void> = {
  c: () => void startCamera(deviceIndex + 1).catch((e: unknown) => console.error('startCamera failed', e)),
  t: () => {
    detector.options.mode = detector.options.mode === 'A' ? 'B' : 'A'
  },
  r: () => {
    detector.captureReference()
    $('hint').textContent = 'Reference captured: only screens that appear from now on are counted.'
  },
  '0': () => detector.reset(),
  v: () => killVideo(),
  s: () => setDrawer(!drawerOpen),
  f: () => toggleFullscreen(),
  escape: () => setDrawer(false),
}

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const action = actions[event.key.toLowerCase()]
  if (action) {
    event.preventDefault()
    action()
  }
})

const bind = (id: string, key: string): void => {
  $(id).addEventListener('click', () => actions[key]?.())
}
bind('switchCam', 'c')
bind('toggleMode', 't')
bind('reference', 'r')
bind('reset', '0')
bind('kill', 'v')
bind('fullscreen', 'f')
bind('closeDrawer', 'escape')
$('defaults').addEventListener('click', restoreDefaults)

// the wall should show the room, not a mouse pointer: hide it after a moment of stillness
let cursorTimer = 0
window.addEventListener('mousemove', () => {
  document.body.classList.remove('idle-cursor')
  window.clearTimeout(cursorTimer)
  cursorTimer = window.setTimeout(() => {
    if (!drawerOpen) document.body.classList.add('idle-cursor')
  }, 2500)
})

// the one hint the operator needs, gone before the room is looking
window.setTimeout(() => $('toast').classList.add('gone'), 6000)
window.setTimeout(() => ($('toast').hidden = true), 7000)

drawStatus()
void startCamera(0).catch((e: unknown) => {
  $('device').textContent = `startCamera threw: ${String(e)}`.slice(0, 110)
  noCamera('The camera did not start', 'Press S for details, then C to try again.')
})
requestAnimationFrame(draw)

// handy in the console while calibrating
;(window as unknown as { detector: MagentaDetector }).detector = detector
