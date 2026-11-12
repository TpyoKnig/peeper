// Live voice waveform while recording (OcuClaw 1.4's "waveform visualizer"): bars of recent
// mic loudness in a small image container beside the status line.
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { png, sendImage } from './images'

const BAR = 3 // px per bar including a 1 px gap

export class Waveform {
  private levels: number[] = []
  private canvas = document.createElement('canvas')
  private sending = false
  private dirty = false

  constructor(
    private bridge: EvenAppBridge,
    private container: { id: number; name: string; width: number; height: number },
  ) {
    this.canvas.width = container.width
    this.canvas.height = container.height
  }

  /** Add one PCM chunk (s16le mono) and redraw. */
  push(pcm: Uint8Array) {
    // DataView: an Int16Array view would throw if the chunk starts at an odd byte offset.
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    const count = pcm.byteLength >> 1
    let sum = 0
    for (let i = 0; i < count; i++) sum += view.getInt16(i * 2, true) ** 2
    const rms = Math.sqrt(sum / Math.max(1, count)) / 32768
    // Speech RMS sits around 0.02-0.2; a square-root curve keeps quiet speech visible.
    this.levels.push(Math.min(1, Math.sqrt(rms * 6)))
    const fit = Math.floor(this.container.width / BAR)
    if (this.levels.length > fit) this.levels.splice(0, this.levels.length - fit)
    void this.flush()
  }

  /** Blank the waveform (recording ended). */
  clear() {
    this.levels = []
    void this.flush()
  }

  // Latest-wins: while one frame is in flight, later chunks just mark the waveform dirty.
  private async flush() {
    if (this.sending) return void (this.dirty = true)
    this.sending = true
    try {
      do {
        this.dirty = false
        const { width, height } = this.container
        const ctx = this.canvas.getContext('2d')!
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = '#fff'
        const left = Math.floor((width - this.levels.length * BAR) / 2) // grows from the centre, then scrolls
        this.levels.forEach((level, i) => {
          const h = Math.max(2, Math.round(level * height))
          ctx.fillRect(left + i * BAR, (height - h) / 2, BAR - 1, h)
        })
        await sendImage(this.bridge, this.container.id, this.container.name, await png(this.canvas))
      } while (this.dirty)
    } catch (error) {
      console.warn('[wave]', error)
    } finally {
      this.sending = false
    }
  }
}
