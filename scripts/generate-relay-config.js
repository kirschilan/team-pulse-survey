"use strict";

// Vercel build step (see vercel.json's buildCommand) -- writes
// public/relay-config.js from the SQUAD_PULSE_RELAY_URL environment
// variable, so a deployed relay's address is set per Vercel environment
// (Production vs. Preview vs. a specific branch) through Vercel's own
// project settings, with no hand-edit of index.html per deploy.
//
// A plain static host with no build step (someone forking this repo onto
// a LAN with no Vercel account at all) never runs this script, so the
// checked-in placeholder public/relay-config.js (a no-op) stays as-is and
// index.html's own protocol/hostname-based default in index.html applies
// instead. See relay/README.md for both paths end to end.

const fs = require("fs");
const path = require("path");

const url = process.env.SQUAD_PULSE_RELAY_URL;
const outPath = path.join(__dirname, "..", "public", "relay-config.js");

const contents = url
  ? "window.SQUAD_PULSE_RELAY_URL = " + JSON.stringify(url) + ";\n"
  : "// No SQUAD_PULSE_RELAY_URL environment variable set at build time --\n" +
    "// index.html's own default applies instead. See relay/README.md.\n";

fs.writeFileSync(outPath, contents);
console.log(
  "[generate-relay-config] " + outPath + (url ? " -> " + url : " left as no-op (SQUAD_PULSE_RELAY_URL unset)")
);
