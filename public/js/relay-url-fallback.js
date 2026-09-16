"use strict";

// SEC-3: pulled out of index.html's own inline <script> so the page's CSP
// (see index.html's <meta http-equiv="Content-Security-Policy">) can use a
// plain script-src 'self' -- no 'unsafe-inline' or per-script hash needed.
// Behavior is unchanged from the inline version.
//
// Where retro sessions actually live-sync (relay-client.js + crypto.js,
// loaded right after this) -- ws:// for a plain local relay, wss:// once
// it's deployed somewhere real. relay-config.js (loaded just before this)
// sets window.SQUAD_PULSE_RELAY_URL directly when a Vercel deployment has
// the SQUAD_PULSE_RELAY_URL environment variable set (see
// scripts/generate-relay-config.js and relay/README.md) -- the `||` below
// only kicks in when that didn't happen. Only defaults to a locally-run
// relay when this PAGE ITSELF is local (file:// or localhost) -- a real
// deployment with no relay configured must NOT silently fall back to
// "ws://localhost:8787", since that means the VISITOR'S OWN machine: Chrome
// flags that as a cross-context private-network request (a scary
// permission prompt for a connection that can never succeed), and
// relay-client.js would then retry forever. Leave it explicitly null
// instead so relay-client.js can recognize "no relay configured" and fail
// fast with one clear message.
window.SQUAD_PULSE_RELAY_URL = window.SQUAD_PULSE_RELAY_URL || (
  (location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "ws://localhost:8787"
    : null
);
