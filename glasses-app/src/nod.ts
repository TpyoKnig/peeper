import type { Presentation } from './cards'
import type { Task } from './tasks'

// Client for the glasses gateway (gateway/server.mjs), which fronts nod's web API.
export const GATEWAY = (import.meta.env.VITE_NOD_GATEWAY as string)?.replace(/\/$/, '')
export const configured = Boolean(GATEWAY)

// Per-device pairing token (see pairing.ts). Not persisted here: the caller is responsible
// for storing it (bridge local storage) and calling setToken again on the next launch.
let token: string | undefined
export function setToken(value: string | undefined) {
  token = value
}

export interface AnswerChoice {
  id: string
  label: string
  description?: string
}
export interface NodMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  streamId?: string | null
  createdAt: string
  // A structured question: options to pick from, and whether it still wants an answer.
  answerChoices?: { options: AnswerChoice[]; multiple: boolean }
  answerChoicesPending?: boolean
  // A structured reply (flights, booking, chart, …): see cards.ts.
  presentation?: Presentation
}
export interface NodState {
  threadId: string
  messages: NodMessage[]
  // Any source: your messages, schedules, app events. 'waiting' means nod is blocked on you.
  turns: { status: 'queued' | 'running' | 'succeeded' | 'waiting' | 'failed' | 'cancelled'; createdAt: string }[]
}
// What nod is doing right now (nod/src/shared/contracts.ts Activity).
export interface Activity {
  turnId: string
  taskId: string | null
  title: string | null
  step: string | null
  site: string | null
  doing: 'queued' | 'model' | 'tool'
  background?: true
}

// The server accepts a choice answer only if the text is exactly this (nod/src/shared/answer-choices.ts).
export function choiceAnswerText(options: AnswerChoice[]) {
  return options
    .map(({ label, description }) => {
      const detail = description?.trim()
      return detail && detail.toLowerCase() !== label.trim().toLowerCase() ? `${label.trim()}: ${detail}` : label.trim()
    })
    .join('\n')
}

async function call(path: string, init: RequestInit = {}) {
  const read = !init.method || init.method === 'GET'
  let timer: ReturnType<typeof setTimeout> | undefined
  const request = () => {
    // Reads time out: a request to an unreachable host can hang instead of failing, which would
    // leave the splash on "Opening Nod…". (setTimeout may be delayed by the SDK's ShadowTimers;
    // that just makes the timeout late, no worse than none. AbortSignal.timeout needs Safari 16.)
    const abort = new AbortController()
    clearTimeout(timer)
    if (read) timer = setTimeout(() => abort.abort(), 8000)
    return fetch(GATEWAY + path, { ...init, signal: abort.signal, headers: { 'x-glasses-key': token ?? '', ...(init.headers ?? {}) } })
  }
  // fetch() rejects with a bare "Load failed" / "Failed to fetch" when the gateway is unreachable.
  // Reads retry once to ride out a transient failure (e.g. a Wi-Fi blip). Writes are never
  // retried: no double-sent messages.
  const res = await request()
    .catch((error) => (read ? request() : Promise.reject(error)))
    .catch(() => {
      throw new Error("Can't reach nod")
    })
  try {
    if (res.status === 401) throw new Error('unpaired')
    if (!res.ok) {
      // nod answers errors as {"error": "<a sentence for people>"}; show that, not the raw body.
      const body = await res.text()
      let message = ''
      try {
        message = String(JSON.parse(body).error ?? '')
      } catch {
        /* not JSON */
      }
      throw new Error(message || `${path} ${res.status}: ${body.slice(0, 120)}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer) // the body is read; don't abort a finished request later
  }
}

export const getState = (): Promise<NodState> => call('/api/state')

// Older messages, `limit` at a time, before the given message (nod returns them oldest-first).
export function getHistory(before: NodMessage, limit = 5): Promise<{ messages: NodMessage[]; hasMore: boolean }> {
  const query = new URLSearchParams({ before: before.createdAt, beforeId: before.id, limit: String(limit) })
  return call(`/api/messages?${query}`)
}

// RFC 4122 v4 UUID. crypto.randomUUID only exists in secure contexts (HTTPS/localhost), and the
// app is served over plain http on the LAN during development; getRandomValues works everywhere.
function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const sendText = (threadId: string, text: string, replyToMessageId?: string, choiceIds?: string[]) =>
  call('/api/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      threadId,
      clientMessageId: uuid(),
      replyToMessageId,
      ...(choiceIds ? { questionAnswer: { choiceIds } } : {}),
    }),
  })

// Speech to text only: nothing is sent to the conversation (the glasses confirm first).
export async function transcribe(pcm: Uint8Array): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([pcmToWav(pcm)], { type: 'audio/wav' }), 'glasses.wav')
  return (await call('/api/speech/transcribe', { method: 'POST', body: form })).text
}

export const stop = () => call('/api/thread/stop', { method: 'POST' })

// nod's tasks: multi-step work it runs (read-only here; see tasks.ts).
export const getTasks = (): Promise<Task[]> => call('/api/tasks')

// An artifact's bytes (e.g. a picture in a presentation).
export async function getArtifact(id: string): Promise<Blob> {
  const res = await fetch(`${GATEWAY}/api/artifacts/${encodeURIComponent(id)}`, { headers: { 'x-glasses-key': token ?? '' } }).catch(() => {
    throw new Error("Can't reach nod")
  })
  if (res.status === 401) throw new Error('unpaired')
  if (!res.ok) throw new Error(`artifact ${res.status}`)
  return res.blob()
}

// Model picker (nod/src/server/models.ts view()).
export interface ModelChoice {
  id: string
  name: string
  efforts?: string[]
}
export interface ModelConnection {
  id: string
  provider: string
  method: string
  label?: string
  status: string
  models: ModelChoice[]
}
export interface ModelSelection {
  connectionId: string
  modelId: string
  effort: string
}
export interface ModelsView {
  connections: ModelConnection[]
  selection: ModelSelection | null
}
export const getModels = (): Promise<ModelsView> => call('/api/models')
export const selectModel = (selection: ModelSelection) =>
  call('/api/models/selection', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(selection) })

export type NodEvent =
  | { type: 'refresh' }
  | { type: 'delta'; turnId: string; streamId?: string; text?: string; done?: boolean }
  | { type: 'activity'; items: Activity[] }

// EventSource can't send headers, so the gateway accepts ?key= on this route only.
export function listen(onEvent: (event: NodEvent) => void, onError: () => void) {
  const source = new EventSource(`${GATEWAY}/api/events?key=${encodeURIComponent(token ?? '')}`)
  source.onmessage = (message) => {
    let event: NodEvent
    try {
      event = JSON.parse(message.data)
    } catch {
      return console.error('[nod] bad event frame', message.data.slice(0, 80))
    }
    onEvent(event)
  }
  source.onerror = onError // EventSource reconnects on its own
  return () => source.close()
}

// G2 mic: PCM s16le, 16 kHz, mono. Prepend a 44-byte RIFF header so nod's STT accepts it.
export function pcmToWav(pcm: Uint8Array, sampleRate = 16000): ArrayBuffer {
  const out = new ArrayBuffer(44 + pcm.length)
  const v = new DataView(out)
  const tag = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)))
  tag(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  tag(36, 'data')
  v.setUint32(40, pcm.length, true)
  new Uint8Array(out, 44).set(pcm)
  return out
}
