// The SDK allows one image send in flight ("No concurrent image sends"), and both the glyph and
// the waveform draw images, so every send goes through this queue.
import { ImageRawDataUpdate, ImageRawDataUpdateResult, type EvenAppBridge } from '@evenrealities/even_hub_sdk'

let tail: Promise<unknown> = Promise.resolve()

export function sendImage(bridge: EvenAppBridge, id: number, name: string, data: Uint8Array): Promise<ImageRawDataUpdateResult> {
  const sent = tail.then(() => bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: id, containerName: name, imageData: data })))
  tail = sent.catch(() => {}) // one failure must not block later sends
  return sent
}

// Encode a canvas as PNG bytes (what updateImageRawData expects). Executor form on purpose:
// Promise.withResolvers is too new for older phone WebViews.
export async function png(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob failed'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export { ImageRawDataUpdateResult }
