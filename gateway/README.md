# Glasses gateway

A zero-dependency Node HTTP server that lets the Even G2 glasses app (a cross-origin
WebView) talk to nod's web API. It holds nod's owner token; each paired glasses device
authenticates with its own per-device token instead of one shared secret.

## Run

```
node --env-file=.env server.mjs
```

Required env:

- `NOD_URL`: nod's base URL (defaults to `http://localhost:4310`)
- `NOD_AUTH_TOKEN`: nod's owner bearer token

Optional env:

- `HOST`: public listener address (default `127.0.0.1`; set to the LAN IP so the phone
  can reach it)
- `PORT`: public listener port (default `8787`)
- `ADMIN_PORT`: admin listener port (default `8788`); **always bound to `127.0.0.1`**,
  never the LAN, regardless of `HOST`

The public listener serves:

- The proxied `/api/*` routes, authenticated per request by an `x-glasses-key` header
  (or `?key=` on `GET /api/events` only, since `EventSource` can't set headers) that must
  match a paired device's token.
- The unauthenticated, CORS-enabled pairing routes: `POST /pair/start` and
  `GET /pair/wait/:pairingId`.

Paired devices are stored in `devices.json` next to this file (mode `600`, gitignored).
It holds each device's name, a SHA-256 hash of its token, and when it was paired, never
the token itself.

## Pairing a device

1. Launch the glasses app without a stored token. It calls `POST /pair/start`, gets back
   a short phrase (e.g. "able acid aged also"), and shows it on the glasses display while
   it polls `GET /pair/wait/:pairingId`.
2. On the machine running the gateway, list pending pairings and approve the one whose
   words match what's on the glasses:

   ```
   node pair.mjs list
   node pair.mjs approve "able acid aged also"
   ```

3. The next `/pair/wait` poll returns the new device's token, which the app stores in its
   own local storage and sends as `x-glasses-key` from then on.

A pairing not approved within 2 minutes expires; the app will start a new one
automatically.

## Managing devices

```
node pair.mjs devices          # list paired devices
node pair.mjs revoke <id>      # revoke a device's access
node pair.mjs mint <name>      # create a device + token directly (for scripts/tests,
                                # no pairing flow)
```

`pair.mjs` talks to the admin API above, which only listens on `127.0.0.1`. Run it on
the same machine as the gateway (or over SSH port-forwarding), never exposed to the LAN.

## Public HTTPS

If the gateway is reachable from the internet rather than just the LAN, put it behind a
TLS-terminating reverse proxy (e.g. Caddy, nginx, or a Cloudflare Tunnel) on `HOST`/`PORT`
and keep `ADMIN_PORT` loopback-only as above. The pairing routes are unauthenticated by
design (a bare pairing code is useless without an admin explicitly approving it), but
running the public listener over plain HTTP on the open internet still exposes it to
on-path attackers who could intercept a token's one-time delivery in `/pair/wait`'s
response: TLS closes that gap. `/api/*` traffic also carries nod's replies, so it
should not be served over plain HTTP once it leaves a trusted LAN.
