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
  try {
    stream?.getTracks().forEach((t) => t.stop())
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
    deviceIndex = devices.length === 0 ? 0 : ((index % devices.length) + devices.length) % devices.length
    const deviceId = devices[deviceIndex]?.deviceId
    // `ideal`, never `exact`, on width/height/frameRate: `exact` throws OverconstrainedError
    // with no prompt and no picture, which looks exactly like a broken camera on stage.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    })
    video.srcObject = stream
    videoDead = false
    await video.play()
    el.device.textContent = `${devices[deviceIndex]?.label || 'camera ' + deviceIndex} (${devices.length} found)`
  } catch (error: unknown) {
    el.device.textContent = `camera error: ${String(error).slice(0, 80)}`
  }
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
  el.visible.textContent = String(result.visible)
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

void startCamera(0)
requestAnimationFrame(draw)

// handy in the console while calibrating
;(window as unknown as { detector: MagentaDetector }).detector = detector
console.info('defaults', DEFAULTS)
