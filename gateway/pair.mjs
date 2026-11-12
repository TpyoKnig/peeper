#!/usr/bin/env node
// CLI for the gateway's admin API (gateway/server.mjs), which is bound to 127.0.0.1 only.
//
//   node pair.mjs list                    # pending pairings awaiting approval
//   node pair.mjs approve "four words"    # approve a pairing, minting its device token
//   node pair.mjs devices                 # paired devices
//   node pair.mjs revoke <id>             # revoke a device
//   node pair.mjs mint <name>             # create a device directly (for scripts/tests)
const ADMIN_URL = process.env.ADMIN_URL ?? `http://127.0.0.1:${process.env.ADMIN_PORT ?? 8788}`;

async function call(method, path, body) {
  const res = await fetch(ADMIN_URL + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`${method} ${path} -> ${res.status}: ${data.error ?? 'unknown error'}`);
    process.exit(1);
  }
  return data;
}

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case 'list': {
    const { pairings } = await call('GET', '/pairings');
    if (!pairings.length) {
      console.log('No pending pairings.');
      break;
    }
    for (const p of pairings) console.log(`${p.pairingId}  "${p.words}"  ${p.name}  (${p.status}, expires ${p.expiresAt})`);
    break;
  }
  case 'approve': {
    const words = args.join(' ');
    if (!words) {
      console.error('usage: pair.mjs approve "four words here"');
      process.exit(1);
    }
    const result = await call('POST', '/approve', { words });
    console.log(`Approved. deviceId=${result.deviceId}`);
    break;
  }
  case 'devices': {
    const { devices } = await call('GET', '/devices');
    if (!devices.length) {
      console.log('No paired devices.');
      break;
    }
    for (const d of devices) console.log(`${d.id}  ${d.name}  paired ${d.createdAt}`);
    break;
  }
  case 'revoke': {
    const id = args[0];
    if (!id) {
      console.error('usage: pair.mjs revoke <id>');
      process.exit(1);
    }
    await call('POST', '/revoke', { id });
    console.log(`Revoked ${id}.`);
    break;
  }
  case 'mint': {
    const name = args.join(' ');
    if (!name) {
      console.error('usage: pair.mjs mint <name>');
      process.exit(1);
    }
    const { deviceId, token } = await call('POST', '/mint', { name });
    console.log(`deviceId=${deviceId}`);
    console.log(`token=${token}`);
    console.log('(shown once - store it now)');
    break;
  }
  default:
    console.error('usage: pair.mjs <list|approve|devices|revoke|mint> [args...]');
    process.exit(1);
}
