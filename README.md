# peeper

Talk to [nod](https://github.com/n8n-io/nod), n8n's personal agent, from Even Realities G2 smart glasses.

Hold the temple (or tap) and speak, check what it heard, send it, and read nod's answer on the glasses. nod's questions show up as a list you pick from, charts open as cards, and you can follow nod's tasks or use saved prompts from a side menu.

## What's here

| Folder | What it is |
|---|---|
| [`glasses-app/`](glasses-app/) | The G2 app (Even Hub SDK, TypeScript, Vite). Runs in the Even Realities phone app and draws on the glasses. |
| [`gateway/`](gateway/) | A small zero-dependency Node proxy between the glasses and nod. It holds nod's owner token, lets through only the routes the glasses need, and pairs each pair of glasses with its own token. |

## Requirements

- nod with the G2 changes from [tpyoknig/nod](https://github.com/tpyoknig/nod) (n8n speech fix, paged history, transcribe-only endpoint). The voice flow needs `POST /api/speech/transcribe`.
- Node 24+.
- Even Realities app 2.2.10 or newer, with developer mode on (sign in at hub.evenrealities.com).

## Run it

1. **nod:** run it as usual and note its URL and owner token (`NOD_AUTH_TOKEN`).
2. **Gateway:**
   ```sh
   cd gateway
   cp .env.example .env   # fill in NOD_URL, NOD_AUTH_TOKEN and HOST (this machine's LAN IP)
   node --env-file=.env server.mjs
   ```
3. **Glasses app:**
   ```sh
   cd glasses-app
   cp .env.example .env.local   # VITE_NOD_GATEWAY=http://<LAN IP>:8787
   npm install
   npx vite --host <LAN IP> --port 5173 --strictPort
   ```
   In `glasses-app/app.json`, set `package_id` to your own reverse-domain id (it ships as `com.example.peeper`) and put the gateway's origin in `permissions[].whitelist`.
4. **Glasses:** `npx evenhub qr --url http://<LAN IP>:5173`, then in the phone app: Even Hub → Scan QR.
5. **Pair:** the glasses show four words. On the gateway machine:
   ```sh
   node gateway/pair.mjs approve "<the four words>"
   ```
   Manage devices with `node gateway/pair.mjs devices` and `revoke <id>`.

To use it away from home, put the gateway and a built copy of the app behind HTTPS, for example with a Cloudflare Tunnel: see [`gateway/TUNNEL.md`](gateway/TUNNEL.md).

## Using it

| Gesture | What happens |
|---|---|
| Hold the temple, release (or tap, tap) | Voice screen with live transcript, then "You said: …" with Send / Say it again / Cancel |
| Swipe down / up | Next page of a long reply / back through earlier exchanges |
| Tap, then hold | Side menu: Yes, No, Answer question, Saved prompts, Tasks, Show card, Model, Stop task |
| Double tap | Exit |

Saved prompts are edited on the phone screen, one per line as `Label | prompt`.

## Security

- nod's owner token never leaves the gateway machine.
- Every request from the glasses needs a per-device token, issued only after you approve its four-word code on the gateway machine. The admin API listens on `127.0.0.1` only and refuses browser requests.
- The gateway forwards a fixed list of nod routes; everything else returns 404.
