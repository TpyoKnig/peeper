# Exposing the glasses gateway over HTTPS

## 1. Why

`glasses-app/app.json`'s `permissions[].whitelist` is an exact-origin allowlist (no
wildcards, no self-signed/invalid certs) and the Even G2 WebView will only talk to
origins listed there. Today that's `http://<LAN IP>:8787`, fine on the home
LAN, useless for anyone testing a private/beta build off-network, and `http://`
content is also why the app can't use `crypto.randomUUID()` or other secure-context
APIs (see glasses-app constraints). A stable `https://` origin fixes both: it works
off-LAN and puts the app in a secure context.

**Quick setup with the Cloudflare API** (what the author's setup uses): create a remotely
managed tunnel (`POST /accounts/<account>/cfd_tunnel` with `config_src: cloudflare`), set its
ingress (`PUT .../cfd_tunnel/<id>/configurations`), add one proxied CNAME per hostname pointing
at `<id>.cfargotunnel.com`, and save the tunnel's connector token
(`GET .../cfd_tunnel/<id>/token`) to `~/.cloudflared/nod-glasses.token` (mode 600). The API
token is only needed for setup; delete it afterwards. Two hostnames:

| Hostname | Goes to | What |
|---|---|---|
| `https://g2.example.com` | `http://127.0.0.1:4173` | the app, built for HTTPS (`dist-public/`, served by `vite preview`) |
| `https://glasses.example.com` | `http://<LAN IP>:8787` | the gateway |

Add `g2.example.com` to `preview.allowedHosts` in `glasses-app/vite.config.ts` and
`https://glasses.example.com` to the whitelist in `glasses-app/app.json`.

Run it (all three must be up):

```sh
cd glasses-app && VITE_NOD_GATEWAY=https://glasses.example.com npx vite build --outDir dist-public && npx vite preview --outDir dist-public
cd gateway && node --env-file=.env server.mjs
TUNNEL_TOKEN="$(cat ~/.cloudflared/nod-glasses.token)" cloudflared tunnel --no-autoupdate run  # env, not argv: keeps it out of `ps`
```

Phone: `evenhub qr --url https://g2.example.com` and scan. A new origin has its own storage, so the
glasses pair once more there. Rebuild `dist-public` after app changes; the LAN dev server
(`:5173`) stays the place for quick iteration. To remove it all: delete the two DNS records and the
tunnel in the Cloudflare dashboard (or API), then `rm ~/.cloudflared/nod-glasses.token`.

The steps below were the original plan (login-based, local config) and are kept for reference.

## 2. Tunnel from this Mac

Run from the Mac that runs the gateway (it listens on the LAN IP only, `<LAN IP>:8787`;
see `HOST` in `gateway/.env`).

```sh
# One-time: opens a browser to pick the zone (your domain) to authorize.
cloudflared tunnel login

# Create a named tunnel; writes a credentials-file under ~/.cloudflared/.
cloudflared tunnel create nod-glasses

# Point glasses.<your-domain> at it (creates a CNAME in Cloudflare DNS).
cloudflared tunnel route dns nod-glasses glasses.<your-domain>
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: nod-glasses
credentials-file: /Users/<you>/.cloudflared/<tunnel-uuid>.json

ingress:
  - hostname: glasses.<your-domain>
    service: http://<LAN IP>:8787   # the gateway binds the LAN IP only (HOST in gateway/.env)
    originRequest:
      noTLSVerify: true          # service is plain http on the LAN side
      disableChunkedEncoding: false   # SSE on /api/events needs chunked streaming, not buffered
      keepAliveConnections: 4
      keepAliveTimeout: 90s
      connectTimeout: 10s
  - service: http_status:404
```

Run it:

```sh
cloudflared tunnel run nod-glasses
```

As a launchd service (keeps running across reboots/logout):

```sh
sudo cloudflared service install
# installs com.cloudflare.cloudflared, reads the config.yml above, starts at boot
sudo launchctl kickstart -k system/com.cloudflare.cloudflared   # restart after config edits
```

Check status/logs with `launchctl print system/com.cloudflare.cloudflared` or
`log stream --predicate 'process == "cloudflared"'`.

## 3. App changes once the tunnel exists

1. `glasses-app/.env.local`: `VITE_NOD_GATEWAY=https://glasses.<your-domain>`
2. `glasses-app/app.json`: add the exact HTTPS origin to the whitelist (keep or drop
   the old LAN entry depending on whether LAN-only testing is still needed):
   ```json
   "whitelist": ["https://glasses.<your-domain>"]
   ```
3. Rebuild/repack the app bundle so the new `VITE_NOD_GATEWAY` is baked in and the
   updated `app.json` ships.

## 4. Security notes

- The gateway (`gateway/server.mjs`) only forwards its fixed allowlist (`routes` and
  `patterns`: messages, audio, stop, state, events, history, models, tasks, artifacts) to
  nod, so a public hostname doesn't expand nod's own surface. Every proxied request needs a
  per-device token issued by pairing (`gateway/README.md`); the pairing endpoints are
  public but only mint a token after you run `node pair.mjs approve "<words>"` on the
  gateway host, and the admin API stays on `127.0.0.1:8788`.
- Review paired devices with `node pair.mjs devices` and revoke anything you don't
  recognise before leaving the tunnel up long-term.
- **Cloudflare Access is not usable here**: Access gates a hostname behind a browser
  login/SSO redirect, and the Even G2 plugin's WebView has no way to complete that
  flow (no visible browser chrome, no human present for the login prompt, and
  `EventSource`/`fetch` from app code can't follow an interactive auth redirect
  anyway). Rely on the gateway's own device-token check instead of Access policies.
- **Never expose nod's own port (`127.0.0.1:4310`) publicly**, not even behind this
  tunnel. Only the gateway, which strips browser-identity headers and injects nod's
  owner token server-side, should ever be reachable from outside the LAN. Point
  `cloudflared`'s `ingress.service` at the gateway (`http://<LAN IP>:8787`), never at
  `NOD_URL`, and never at the admin port 8788.
