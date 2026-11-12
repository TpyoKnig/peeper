// The nod glyph (ring + dot) rendered for the G2 image container, animated by state.
// Geometry and keyframes mirror nod's web app: nod/src/web/components/motion.{tsx,css}
//   ring: centre (16,16), r 10, stroke 4    dot: centre (25,6), r 4    viewBox 32x32
// The G2 is monochrome green, so nod's pink dot becomes the brightest element and
// the black ring a dimmer one.
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { ImageRawDataUpdateResult, png, sendImage } from './images'

export type GlyphState = 'boot' | 'idle' | 'listening' | 'thinking' | 'waiting'
type OneShot = 'hop' | 'droop' | 'nod' | 'pulse'

interface Pose {
  ringDy: number // viewBox units
  ringSy: number
  orbit: number // degrees the dot has travelled clockwise round the ring
  dotDx: number
  dotDy: number
  dotSx: number
  dotSy: number
  dotAlpha: number
  rot: number // whole-glyph rotation (the head nod)
  dy: number
  sx: number
  sy: number
}
const REST: Pose = { ringDy: 0, ringSy: 1, orbit: 0, dotDx: 0, dotDy: 0, dotSx: 1, dotSy: 1, dotAlpha: 1, rot: 0, dy: 0, sx: 1, sy: 1 }
type Key = [at: number, pose: Partial<Pose>]

// CSS keyframes from motion.css, as (fraction, pose) pairs. Missing ends default to REST.
const MOTIONS: Record<GlyphState | OneShot, { ms: number; keys: Key[]; repeat: number }> = {
  // ob-bounce-ring + ob-bounce-dot (dot lags the ring by 150 ms)
  boot: { ms: 1500, repeat: Infinity, keys: [[0.38, { ringDy: 1.92, ringSy: 0.93 }], [0.48, { dotDy: 2.56 }], [0.65, { ringDy: -0.32 }], [0.75, { dotDy: -0.64 }]] },
  idle: { ms: 1, repeat: 1, keys: [] },
  // Listening: the dot circles the ring slowly, swollen (thinking spins it fast at normal size)
  listening: { ms: 2400, repeat: Infinity, keys: [[0, { orbit: 0, dotSx: 1.3, dotSy: 1.3 }], [1, { orbit: 360, dotSx: 1.3, dotSy: 1.3 }]] },
  // ob-spin: the dot orbits the ring
  thinking: { ms: 1100, repeat: Infinity, keys: [[0, { orbit: 0 }], [1, { orbit: 360 }]] },
  // ob-waiting: the dot breathes while nod waits on you. Three breaths, then hold: no endless BLE traffic.
  waiting: { ms: 2400, repeat: 3, keys: [[0.5, { dotAlpha: 0.3 }]] },
  // ob-dot-hop: a reply landed
  hop: { ms: 480, repeat: 1, keys: [[0.3, { dotDx: 2, dotDy: -5, dotSx: 1.35, dotSy: 1.35 }], [0.55, { dotDx: 1, dotSx: 0.9, dotSy: 1.1 }], [0.75, { dotDx: 0.5, dotDy: -1.5, dotSx: 1.06, dotSy: 1.06 }]] },
  // ob-dot-droop: something went wrong
  droop: { ms: 440, repeat: 1, keys: [[0.35, { dotAlpha: 0.6, dotDx: -1.5, dotDy: 3, dotSx: 0.75, dotSy: 0.75 }], [0.7, { dotDx: -0.5, dotDy: 0.5, dotSx: 1.04, dotSy: 1.04 }]] },
  // ob-brand-nod: the whole glyph nods. Played once nod is connected.
  nod: { ms: 1800, repeat: 1, keys: [[0.28, { dy: 2, rot: -7, sx: 1.03, sy: 0.94 }], [0.55, { rot: 4, sx: 0.98, sy: 1.04 }], [0.78, { rot: -1 }]] },
  // ob-pulse: idle greeting, twice
  pulse: { ms: 2800, repeat: 2, keys: [[0.5, { dotSx: 1.2, dotSy: 1.2 }]] },
}

const ease = (t: number) => t * t * (3 - 2 * t) // ≈ CSS ease-in-out

/** Wait for the next display frame, or 50 ms, whichever comes first. requestAnimationFrame stops
 * while the page isn't visible (the WebView behind the Even app, an occluded simulator) and the
 * SDK's ShadowTimers can stall setTimeout; racing them keeps animations moving either way. */
export function tick(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
    setTimeout(resolve, 50)
  })
}

function poseAt(keys: Key[], t: number, linear: boolean): Pose {
  const all: Key[] = [[0, {}], ...keys, [1, {}]]
  const pose = { ...REST }
  for (const field of Object.keys(REST) as (keyof Pose)[]) {
    // Each field animates between the keyframes that mention it (like CSS per-property tracks).
    const track = all.filter(([, p], i) => field in p || i === 0 || i === all.length - 1)
    const value = (k: Key) => k[1][field] ?? REST[field]
    let i = track.findIndex(([at]) => at >= t)
    if (i <= 0) i = 1
    const [a, b] = [track[i - 1], track[i]]
    const span = b[0] - a[0] || 1
    const local = (t - a[0]) / span
    pose[field] = value(a) + (value(b) - value(a)) * (linear ? local : ease(local))
  }
  return pose
}

const PAD = 5 // viewBox units around the 32x32 glyph, so the hop and nod stay in frame
const RING = 0x8c // dim green
const DOT = 0xff // brightest green: the "pink" accent

function draw(ctx: CanvasRenderingContext2D, size: number, p: Pose) {
  const s = size / (32 + PAD * 2)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)
  ctx.setTransform(s, 0, 0, s, PAD * s, PAD * s)
  // whole glyph: nod rotation/squash about the centre
  ctx.translate(16, 16 + p.dy)
  ctx.rotate((p.rot * Math.PI) / 180)
  ctx.scale(p.sx, p.sy)
  ctx.translate(-16, -16)
  // ring
  ctx.save()
  ctx.translate(16, 16 + p.ringDy)
  ctx.scale(1, p.ringSy)
  ctx.strokeStyle = `rgb(${RING},${RING},${RING})`
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(0, 0, 10, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  // dot: orbit about the ring centre, then its own hop/swell about (25,6)
  ctx.save()
  ctx.translate(16, 16)
  ctx.rotate((p.orbit * Math.PI) / 180)
  ctx.translate(9 + p.dotDx, -10 + p.dotDy)
  ctx.scale(p.dotSx, p.dotSy)
  const level = Math.round(DOT * p.dotAlpha)
  ctx.fillStyle = `rgb(${level},${level},${level})`
  ctx.beginPath()
  ctx.arc(0, 0, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const FRAME_MS = 100 // the SDK paces image sends at >= 100 ms, so ~10 fps is the ceiling

async function renderFrames(size: number, name: GlyphState | OneShot): Promise<Uint8Array[]> {
  const motion = MOTIONS[name]
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const count = Math.max(1, Math.round(motion.ms / FRAME_MS))
  const frames: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    draw(ctx, size, poseAt(motion.keys, i / count, name === 'thinking'))
    frames.push(await png(canvas))
  }
  return frames
}

// Drives one image container. Frames are chosen by elapsed time, and the loop is paced by
// awaiting each send (no setTimeout/setInterval: the simulator can stall those).
export class Glyph {
  private frames = new Map<string, Promise<Uint8Array[]>>()
  // `ready` flips once this motion's frames exist; its clock starts then, not when it was asked
  // for, so a one-shot never "finishes" while its frames are still rendering.
  private current: { name: GlyphState | OneShot; started: number; then: GlyphState; ready: boolean } = { name: 'idle', started: 0, then: 'idle', ready: false }
  private wake: () => void = () => {}
  private lastSent?: Uint8Array
  private running = false
  // Bumped by set/play/retarget: a step that overlapped one of those must not trust what it sent
  // (a page rebuild mid-send blanks the image, and the loop would otherwise think it is shown).
  private version = 0

  constructor(
    private bridge: EvenAppBridge,
    private container: { id: number; name: string; size: number },
  ) {
    this.prerender()
  }

  // Render every motion for this size up front, so one-shots (hop, droop, nod) start instantly.
  private prerender() {
    // Failures here are retried (and logged) when run() asks for that motion.
    for (const name of Object.keys(MOTIONS) as (GlyphState | OneShot)[]) this.framesFor(name).catch(() => {})
  }

  private framesFor(name: GlyphState | OneShot) {
    const key = `${this.container.size}:${name}` // one cache per size: small chat logo, big listening logo
    let frames = this.frames.get(key)
    if (!frames) {
      // A failed render is dropped from the cache so the next request tries again.
      frames = renderFrames(this.container.size, name).catch((error) => {
        this.frames.delete(key)
        throw error
      })
      this.frames.set(key, frames)
    }
    return frames
  }

  /** Switch to a looping or resting state. A one-shot in progress finishes first, then settles here. */
  set(state: GlyphState) {
    if (this.current.name !== this.current.then) return void (this.current.then = state)
    if (this.current.name === state) return
    this.current = { name: state, started: Date.now(), then: state, ready: false }
    this.version++
    this.wake()
  }

  /** Play a one-shot (hop, droop, nod, pulse), then settle into `then`. */
  play(shot: OneShot, then: GlyphState) {
    this.current = { name: shot, started: Date.now(), then, ready: false }
    this.version++
    this.wake()
  }

  /** Point the glyph at a different container (after a page rebuild). Clears the frame cache if the size changed. */
  retarget(container: { id: number; name: string; size: number }) {
    if (container.size !== this.container.size) {
      this.container = container
      this.prerender() // cached sizes return at once
    }
    this.container = container
    this.lastSent = undefined
    this.version++
    this.wake()
  }

  async run() {
    if (this.running) return
    this.running = true
    for (;;) {
      const version = this.version
      try {
        await this.step()
        if (version !== this.version) this.lastSent = undefined
      } catch (error) {
        // A failed render or send must not kill the loop: log, forget what we think is shown,
        // and park until the next state change (unless one already happened during the step).
        console.warn('[glyph]', error)
        this.lastSent = undefined
        if (version !== this.version) continue
        await new Promise<void>((resolve) => (this.wake = resolve))
      }
    }
  }

  private async step() {
    const current = this.current
    const { name, then } = current
    const motion = MOTIONS[name]
    const frames = await this.framesFor(name)
    if (!current.ready) {
      current.ready = true
      current.started = Date.now()
    }
    const elapsed = Date.now() - current.started
    const finished = elapsed >= motion.ms * motion.repeat
    if (finished && name !== then) {
      if (this.current === current) this.current = { name: then, started: Date.now(), then, ready: false }
      return
    }
    // Time picks the frame, so a slow link drops frames instead of slowing the motion.
    const frame = finished ? frames[0] : frames[Math.floor(elapsed / FRAME_MS) % frames.length]
    if (frame === this.lastSent) {
      if (finished) {
        // Resting frame already on the glasses: sleep until set()/play()/retarget() wakes us.
        await new Promise<void>((resolve) => (this.wake = resolve))
      } else {
        // The link outran the clock (the simulator answers sends instantly). Wait for the next
        // display frame rather than resending.
        await tick()
      }
      return
    }
    this.lastSent = frame
    const result = await sendImage(this.bridge, this.container.id, this.container.name, frame)
    // The frame didn't land: throw so run() clears lastSent and parks instead of hammering the link.
    if (result !== ImageRawDataUpdateResult.success) throw new Error(`image send failed: ${result}`)
  }
}
