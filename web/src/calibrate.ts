/**
 * Camera calibration bench. Open this with the GoPro plugged in, tune the sliders against the
 * real room, and write the numbers into the projector page.
 *
 * getUserMedia needs a secure context: https, or localhost. On a plain http LAN address
 * navigator.mediaDevices is simply undefined, with no error dialog — hence the banner below.
 */
import { DEFAULTS, GRID_H, GRID_W, MagentaDetector, type Options } from './detect.js'

const video = document.getElementById('video') as HTMLVideoElement
const overlay = document.getElementById('overlay') as HTMLCanvasElement
const ctx = overlay.getContext('2d')!

const el = {
  total: document.getElementById('total') as HTMLElement,
  visible: document.getElementById('visible') as HTMLElement,
  mode: document.getElementById('mode') as HTMLElement,
  perf: document.getElementById('perf') as HTMLElement,
  device: document.getElementById('device') as HTMLElement,
  hint: document.getElementById('hint') as HTMLElement,
}

el.device.textContent = 'script loaded, asking for the camera…'
window.addEventListener('error', (e) => {
  el.device.textContent = `JS error: ${e.message}`.slice(0, 110)
})
window.addEventListener('unhandledrejection', (e) => {
  el.device.textContent = `promise rejected: ${String(e.reason)}`.slice(0, 110)
})

const detector = new MagentaDetector()
let devices: MediaDeviceInfo[] = []
let deviceIndex = 0
let stream: MediaStream | null = null
let videoDead = false

function slider(id: string, key: keyof Options, label: string, format = (v: number) => String(v)): void {
  const input = document.getElementById(id) as HTMLInputElement
  const out = document.getElementById(label) as HTMLElement
  const apply = (): void => {
    const value = Number(input.value)
    ;(detector.options as Record<string, unknown>)[key] = value
    out.textContent = format(value)
  }
  input.addEventListener('input', apply)
  apply()
}

slider('threshold', 'threshold', 'vThreshold')
slider('minArea', 'minArea', 'vMinArea')
slider('radius', 'radius', 'vRadius')
slider('cooldown', 'cooldownMs', 'vCooldown')

async function startCamera(index = 0): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    el.device.textContent = 'no mediaDevices — open this over https or on localhost'
    el.hint.textContent =
      'navigator.mediaDevices is undefined. That happens on a plain-http LAN address: the camera ' +
      'only works over https or on localhost. Nothing else is wrong.'
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
      el.device.textContent = `${track?.label || devices[deviceIndex]?.label || 'camera'} · ${settings?.width ?? '?'}x${settings?.height ?? '?'} (${devices.length} found${i > 0 ? ', fallback' : ''})`
      return
    } catch (error: unknown) {
      // release the stream we may have just taken, or the next attempt fights our own handle
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      video.srcObject = null
      const name = error instanceof Error ? error.name : String(error)
      const message = error instanceof Error ? error.message : ''
      console.error('getUserMedia failed', constraints, error)
      el.device.textContent = `camera ${name}: ${message}`.slice(0, 110)
      if (name === 'NotReadableError') {
        el.hint.textContent =
          'NotReadableError: another page or app is holding the camera. Close the other calibrate ' +
          'tab, the Windows Camera app, Teams or OBS, then press C.'
      }
      await new Promise((r) => setTimeout(r, 350))
    }
  }
  el.device.textContent = `no camera after 3 attempts · ${devices.length} device(s) listed — press C`
}

// --- the loop ---------------------------------------------------------------------------

let frames = 0
let lastFpsAt = performance.now()
let fps = 0
let lastVideoTime = -1
let frozenSince = 0

function draw(): void {
  requestAnimationFrame(draw)
  if (videoDead || video.readyState < 2) return

  // a frozen currentTime for 2 s means the capture path died: on stage this auto-degrades
  if (video.currentTime === lastVideoTime) {
    if (frozenSince === 0) frozenSince = performance.now()
    else if (performance.now() - frozenSince > 2000) el.device.textContent = 'video stalled — press V'
  } else {
    frozenSince = 0
    lastVideoTime = video.currentTime
  }

  const result = detector.process(video, performance.now())

  const w = overlay.clientWidth
  const h = overlay.clientHeight
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w
    overlay.height = h
  }
  // the video is object-fit: contain, so letterbox the overlay the same way
  const scale = Math.min(w / GRID_W, h / GRID_H)
  const offsetX = (w - GRID_W * scale) / 2
  const offsetY = (h - GRID_H * scale) / 2

  ctx.clearRect(0, 0, w, h)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#FF00E5'
  ctx.font = '12px ui-monospace, monospace'
  for (const blob of result.blobs) {
    ctx.strokeRect(
      offsetX + blob.minX * scale,
      offsetY + blob.minY * scale,
      (blob.maxX - blob.minX + 1) * scale,
      (blob.maxY - blob.minY + 1) * scale,
    )
    ctx.fillStyle = '#FF00E5'
    ctx.fillText(String(blob.area), offsetX + blob.minX * scale, offsetY + blob.minY * scale - 4)
  }
  for (const source of result.sources) {
    ctx.beginPath()
    ctx.arc(offsetX + source.x * scale, offsetY + source.y * scale, detector.options.radius * scale, 0, Math.PI * 2)
    ctx.strokeStyle = source.cooling ? 'rgba(255,184,107,.9)' : 'rgba(90,255,160,.55)'
    ctx.stroke()
  }

  el.total.textContent = String(result.total)
  el.visible.textContent = `${result.visible} écran(s) · ${result.blobs.length} blob(s)`
  const cap = document.getElementById('capInfo')
  if (cap) cap.textContent = `max +${result.visible}/4s (1 par écran)`
  el.mode.textContent = detector.options.mode

  frames += 1
  const now = performance.now()
  if (now - lastFpsAt > 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt))
    frames = 0
    lastFpsAt = now
  }
  el.perf.textContent = `${result.ms.toFixed(2)} ms/frame · ${fps} fps`
}

// --- controls ---------------------------------------------------------------------------

function killVideo(): void {
  videoDead = true
  stream?.getTracks().forEach((t) => t.stop())
  video.srcObject = null
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  el.device.textContent = 'video killed (V) — the round still settles from a typed count'
}

const actions: Record<string, () => void> = {
  c: () => void startCamera(deviceIndex + 1),
  t: () => {
    detector.options.mode = detector.options.mode === 'A' ? 'B' : 'A'
  },
  r: () => {
    detector.captureReference()
    el.hint.textContent = 'reference captured: only screens that appear from now on are counted.'
  },
  '0': () => detector.reset(),
  v: () => killVideo(),
}

window.addEventListener('keydown', (event) => {
  const action = actions[event.key.toLowerCase()]
  if (action) {
    event.preventDefault()
    action()
  }
})

document.getElementById('switchCam')!.addEventListener('click', () => actions.c!())
document.getElementById('toggleMode')!.addEventListener('click', () => actions.t!())
document.getElementById('reference')!.addEventListener('click', () => actions.r!())
document.getElementById('reset')!.addEventListener('click', () => actions['0']!())
document.getElementById('kill')!.addEventListener('click', () => actions.v!())

void startCamera(0).catch((e: unknown) => {
  el.device.textContent = `startCamera threw: ${String(e)}`.slice(0, 110)
})
requestAnimationFrame(draw)

// handy in the console while calibrating
;(window as unknown as { detector: MagentaDetector }).detector = detector
console.info('defaults', DEFAULTS)
