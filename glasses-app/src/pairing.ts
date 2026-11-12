// Pairs this glasses device with the gateway: exchanges a spoken pairing code for a
// per-device token and stores it in the device's own local storage so future launches
// skip this flow. See gateway/server.mjs (/pair/start, /pair/wait) and gateway/pair.mjs.
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { GATEWAY, setToken } from './nod'

const STORAGE_KEY = 'nodToken'

// Kept in both the Even bridge's storage and the WebView's own: if either doesn't survive a
// relaunch on the phone, the other still spares a Mac-side re-approval. Storage errors never
// cost an already-approved token.
const web = {
  get: () => { try { return window.localStorage.getItem(STORAGE_KEY) ?? '' } catch { return '' } },
  set: (v: string) => { try { window.localStorage.setItem(STORAGE_KEY, v) } catch { /* unavailable */ } },
}
async function save(bridge: EvenAppBridge, value: string) {
  web.set(value)
  await bridge.setLocalStorage(STORAGE_KEY, value).catch(() => false)
}

async function startPairing(): Promise<{ pairingId: string; words: string }> {
  const res = await fetch(`${GATEWAY}/pair/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Even G2' }),
  })
  if (!res.ok) throw new Error(`pair/start ${res.status}`)
  return res.json()
}

// The gateway holds this request open for up to ~25s and answers as soon as an admin runs
// `node pair.mjs approve "<words>"`, so this loop needs no client-side timer of its own.
async function waitOnce(pairingId: string): Promise<{ status: 'pending' } | { status: 'approved'; token: string }> {
  const res = await fetch(`${GATEWAY}/pair/wait/${encodeURIComponent(pairingId)}`)
  if (res.status === 404) throw new Error('expired')
  if (!res.ok) throw new Error(`pair/wait ${res.status}`)
  return res.json()
}

export async function ensureToken(bridge: EvenAppBridge, show: (line: string) => void): Promise<string> {
  const stored = (await bridge.getLocalStorage(STORAGE_KEY).catch(() => '')) || web.get()
  if (stored) {
    setToken(stored)
    return stored
  }
  let pairing = await startPairing()
  show(`Pair code: ${pairing.words}`)
  for (;;) {
    try {
      const result = await waitOnce(pairing.pairingId)
      if (result.status === 'approved') {
        await save(bridge, result.token)
        setToken(result.token)
        return result.token
      }
      // still pending: the gateway already waited ~25s, so loop straight into the next poll
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'expired') throw error
      pairing = await startPairing()
      show(`Pair code: ${pairing.words}`)
    }
  }
}

export async function forgetToken(bridge: EvenAppBridge): Promise<void> {
  await save(bridge, '')
  setToken(undefined)
}
