"use strict";

// Steps 3-5 of STATUS.md's "Board sync" plan, opt-in per-device team sync,
// PLUS a security fix that replaced the original typed "team code" (see
// STATUS.md's session log): a human-chosen, human-typed code was both this
// device's room-routing id AND its encryption key material. Fine for a
// retro session (app-generated random code, forgotten within minutes of
// the session ending) but wrong for a persistent team board -- a
// user-chosen code like "MYSQUAD" is a dictionary word, not random, and
// once board sync adds real durability that low-entropy code is
// guessable, forever, by anyone who can open a WebSocket to the relay
// (which can't itself distinguish a guess from a legitimate join -- it's
// deliberately content-blind).
//
// The fix mirrors Excalidraw's real architecture (verified before this was
// built -- see STATUS.md): a high-entropy secret (128 bits,
// crypto.js's generateSecret()) is what the encryption key derives from,
// and it's never typed or spoken -- only ever shared as a link or QR code
// (teamLinkFor()/renderQrInto(), the same UI pattern retro sessions
// already use for joining). The relay only ever sees a SEPARATE, one-way
// hash of that secret (crypto.js's roomIdFor()) for routing -- knowing the
// room id buys an attacker nothing, since it doesn't run backward to the
// secret. With no secret set (the default), this whole file stays inert.

var TEAM_SECRET_KEY = "squadpulse:teamSecret";
// Step 7 of STATUS.md's "Board sync" plan: promoted from opt-in to
// default-on. This flag (never cleared once set) is what lets a device
// tell "never configured -- give it a default team" apart from "this
// device explicitly stopped syncing -- respect that, don't silently
// re-enable it." Set the moment ANY secret is ever stored, by whichever
// path set it (the default bootstrap below, opening a link, or the manual
// Create/Join buttons).
var TEAM_SYNC_EVER_INITIALIZED_KEY = "squadpulse:teamSync:everInitialized";

function getTeamSecret(){
  try{ return localStorage.getItem(TEAM_SECRET_KEY) || ""; }catch(e){ return ""; }
}
function setTeamSecret(secret){
  try{
    if(secret){
      localStorage.setItem(TEAM_SECRET_KEY, secret);
      localStorage.setItem(TEAM_SYNC_EVER_INITIALIZED_KEY, "1");
    } else {
      localStorage.removeItem(TEAM_SECRET_KEY);
    }
  }catch(e){ /* storage unavailable -- team sync just won't persist across reloads on this device */ }
}
// SEC-4 (STATUS.md's "Security hardening backlog"): the secret lives in
// the URL FRAGMENT (#team=...), not the query string -- a fragment is
// never sent to any server at all (not in the initial request, not in a
// Referer header on the next click), unlike a query param, which a static
// host's own access logs can capture before this page's JS ever runs.
// Kept as its own function (rather than inlined into the two callers
// below) since generating and parsing it need to agree on the exact same
// shape.
function teamLinkFor(secret){
  return window.location.origin + window.location.pathname + "#team=" + encodeURIComponent(secret);
}
// Accepts either a bare secret or a full team link someone pasted (the
// input takes both, so "paste the link you were sent" and "the link
// worked and you're just re-entering it" both just work). Checks the
// fragment first (the current, only form this app itself generates), then
// falls back to the legacy ?team= query form so a link shared/bookmarked
// before SEC-4 still works.
function parseTeamSecretInput(raw){
  raw = String(raw||"").trim();
  if(!raw) return "";
  try{
    var url = new URL(raw, window.location.href);
    var fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("team");
    if(fromHash) return fromHash;
    var fromQuery = url.searchParams.get("team");
    if(fromQuery) return fromQuery;
  }catch(e){ /* not a URL -- fall through and treat it as a bare secret */ }
  return raw;
}

// Opening a real team link persists it to this device immediately, then
// strips it from the visible URL/history -- the same hygiene a magic-link
// auth flow uses, so the secret doesn't linger in browser history. Checks
// the fragment (#team=, current) first, then the legacy ?team= query form,
// same precedence as parseTeamSecretInput() above.
//
// SEC-4 fix: the cleanup below used to be skipped entirely whenever the
// URL's secret already matched what this device had stored (an early
// `return` before ever reaching the history rewrite) -- e.g. re-opening the
// same bookmarked/shared link a second time, or a reload. That left the
// secret sitting in the visible URL (and, for a query-string link, already
// sent to the server on THIS load) indefinitely. Cleanup now always runs
// when the URL carries a team param at all; only the (idempotent)
// setTeamSecret() call itself is skipped when there's nothing new to store.
(function autoConnectFromLink(){
  var fromHash = getFragmentParam("team");
  var fromQuery = !fromHash && getQueryParam("team");
  var found = fromHash || fromQuery;
  if(!found) return;
  if(found !== getTeamSecret()) setTeamSecret(found);
  try{
    var url = new URL(window.location.href);
    url.searchParams.delete("team");
    var hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    hashParams.delete("team");
    var newHash = hashParams.toString();
    window.history.replaceState({}, "", url.pathname + url.search + (newHash ? "#" + newHash : ""));
  }catch(e){ /* history API unavailable -- the param just stays visible, harmless */ }
})();

// The actual default-on bootstrap: a device that has NEVER had a team
// secret (not opened a link, not clicked Create/Join, and never explicitly
// disconnected either) gets a fresh one generated automatically, so it's
// ready to share the moment someone opens Admin -- no click required. A
// device that DID explicitly stop syncing (TEAM_SYNC_EVER_INITIALIZED_KEY
// is set, but the secret itself was cleared) is left alone; re-enabling
// from there is the manual Create/Join buttons, same as before this step.
(function ensureDefaultTeamSecret(){
  if(getTeamSecret()) return;
  try{
    if(localStorage.getItem(TEAM_SYNC_EVER_INITIALIZED_KEY)) return;
  }catch(e){ /* localStorage unavailable -- can't remember a prior disconnect either way; proceed as first-time */ }
  setTeamSecret(SquadPulseCrypto.generateSecret());
})();

function syncedAtKeyFor(roomId){ return "squadpulse:teamRoom:syncedAt:" + roomId; }
function getSyncedAt(roomId){
  try{ return localStorage.getItem(syncedAtKeyFor(roomId)) || ""; }catch(e){ return ""; }
}
function setSyncedAt(roomId, iso){
  try{ localStorage.setItem(syncedAtKeyFor(roomId), iso); }catch(e){ /* ditto -- worst case, a later hydrate re-checks against nothing and just re-applies */ }
}

function boardSnapshotPayload(){
  return { squads: state.squads, dimensions: state.dimensions, config: state.config, updatedAt: nowIso() };
}
function teamBoardPath(roomId){ return "boards/" + roomId; }

// Squads, dimensions, and config are three INDEPENDENT db.js listeners,
// each firing on its own schedule -- state.squads can already reflect the
// real local board while state.dimensions is still whatever state.js
// initially seeded it to (PLACEHOLDER_DIMENSIONS), or vice versa. Pushing
// a snapshot built from `state` before all three have settled at least
// once pushes a genuinely INCONSISTENT board (real squads + placeholder
// dimensions, say) -- and with a live subscription open, that snapshot
// echoes straight back and overwrites the real local data with it. This
// was invisible while board sync was opt-in (nothing pushed during a
// normal boot), and surfaced immediately once step 7 made it run by
// default on every page load. db.js calls markLocalBoardPieceReady() from
// each of the three listeners' first fire; pushBoardSnapshotIfConnected()
// below refuses to push anything until all three have reported in.
var localBoardReady = { squads: false, dimensions: false, config: false };
function markLocalBoardPieceReady(piece){ localBoardReady[piece] = true; }
function isLocalBoardReady(){
  return localBoardReady.squads && localBoardReady.dimensions && localBoardReady.config;
}

// While a hydrate-triggered rewrite of local squad/dimension/config docs is
// in flight, the very same db.js listeners that normally trigger a push
// would otherwise fire once per doc touched, each pushing back an
// only-partially-applied intermediate board. Suppressing pushes for that
// one window means the relay only ever sees either the pre-hydrate or the
// fully post-hydrate board, never something in between.
var hydrating = false;

// Same hazard, different trigger: a LOCAL multi-doc rewrite (today: only
// templates.js's loadTemplate(), switching starter templates) writes new
// dimension docs and then a new meta/config doc as SEPARATE Firestore-like
// operations. Each one independently fires a db.js onSnapshot listener
// that calls pushBoardSnapshotIfConnected() -- so the moment the new
// dimension docs land but before the config write follows, a push escapes
// built from `state` at that exact instant: the NEW dimensions, but still
// the OLD config (activeTemplateName/attribution). With a live subscription
// open (board sync is default-on for every device), that inconsistent
// snapshot echoes straight back and overwrites the just-loaded template's
// config with the PREVIOUS template's -- real bug, reported from usage:
// loading Tuckman left the dimension grid showing Tuckman's 5 stages but
// the attribution/model name still reading Spotify's. Any file doing a
// similar multi-doc local rewrite should wrap it in
// suppressBoardPushDuring(fn) rather than poking `hydrating` directly (that
// flag is specifically for applying a REMOTE snapshot, and shares
// `pendingRemoteApply` bookkeeping this local-rewrite case has no use for).
var suppressingLocalRewrite = false;
function suppressBoardPushDuring(work){
  suppressingLocalRewrite = true;
  function done(){ suppressingLocalRewrite = false; pushBoardSnapshotIfConnected(); }
  return work().then(function(result){ done(); return result; }, function(err){ done(); throw err; });
}

function pushBoardSnapshotIfConnected(){
  if(hydrating || suppressingLocalRewrite) return;
  if(!isLocalBoardReady()) return; // don't push a snapshot built from a still-partially-loaded local board
  var secret = getTeamSecret();
  if(!secret || !state.db) return;
  // A device joining an EXISTING team must check whether the team already
  // has real data before pushing its own (possibly stale, pre-hydrate)
  // local board -- otherwise this device's own "here's what I had before
  // I even looked" can race a teammate's real edit and win purely on
  // timestamp, silently erasing it. Found exactly this way: step 7's
  // default-on bootstrap means EVERY device, including one that just
  // opened someone else's team link, reaches "local board fully loaded"
  // (the check above) before its own hydrate's relay round-trip
  // necessarily finishes. Waiting for at least one hydrate ATTEMPT
  // (success, not-found, or give-up-after-retries all count) for this
  // exact secret closes that window without needing to block boot on it
  // (hydrateFromTeamIfConnected() itself stays un-awaited).
  if(hydrateAttemptedForSecret !== secret) return;
  // Capture the payload (and its updatedAt timestamp) SYNCHRONOUSLY, before
  // the async roomIdFor() call -- multiple pushes can be in flight at once
  // (a burst of board changes each fires its own push), and the underlying
  // crypto.subtle.digest() calls are NOT guaranteed to resolve in the same
  // order they were started. Stamping the timestamp only after roomIdFor()
  // resolves let a LATER push's payload occasionally get an EARLIER
  // timestamp than an EARLIER push's -- breaking last-write-wins for
  // whoever reads these back (found via a real, reproducible ordering bug
  // once step 7 made every boot fire a "genesis" push immediately followed
  // by a real edit's push in quick succession).
  var payload = boardSnapshotPayload();
  SquadPulseCrypto.roomIdFor(secret).then(function(roomId){
    return state.db.doc(teamBoardPath(roomId), secret).set(payload).then(function(){
      setSyncedAt(roomId, payload.updatedAt);
    });
  }).catch(function(err){
    diag("Team sync push failed: " + (err && err.code ? err.code : String(err)));
  });
}

// A remote snapshot's nested objects/arrays (a squad's `dimensions`, a
// dimension's `statements`/`scoreBands`/`strategies`) come back frozen --
// deepFreezeClone() in both relay-client.js and local-store.js recursively
// Object.freeze()s everything a doc.data() call hands out, matching the
// real platform's own snapshot semantics. Writing one of those frozen
// values straight into a LOCAL doc means that doc's own future in-place
// edits (e.g. persistDimensionRatings()'s deepMerge(), which ADDS keys to
// sq.dimensions) throw ("object is not extensible") the moment they touch
// it. db.js's own squads listener already clones for exactly this reason
// when frozen data flows FROM the db INTO `state`; this does the same
// thing in the other direction, for remote data flowing INTO a local doc.
function plainClone(value){
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// Rewrites the local squads/dimensions/meta-config docs to match a remote
// board snapshot -- add/update what the remote has, remove what it no
// longer does. Reads the CURRENT local doc ids via a fresh get() rather
// than trusting `state.squads`/`state.dimensions` (which, at boot, are
// still whatever state.js seeded them to -- the real local board hasn't
// loaded yet at the point this runs; see initDb()'s ordering).
function applyRemoteBoardSnapshot(remote){
  var db = state.db;
  var remoteSquads = remote.squads || [];
  var remoteDims = remote.dimensions || [];
  var remoteSquadIds = remoteSquads.map(function(s){ return s.id; });
  var remoteDimKeys = remoteDims.map(function(d){ return d.key; });

  return Promise.all([db.collection("squads").get(), db.collection("dimensions").get()]).then(function(snaps){
    var localSquadIds = snaps[0].docs.map(function(d){ return d.id; });
    var localDimKeys = snaps[1].docs.map(function(d){ return d.id; });
    var ops = [];
    localSquadIds.forEach(function(id){
      if(remoteSquadIds.indexOf(id) === -1) ops.push(db.collection("squads").doc(id).delete());
    });
    remoteSquads.forEach(function(s){
      ops.push(db.collection("squads").doc(s.id).set({
        name: s.name || "Untitled squad", order: s.order || 0, dimensions: plainClone(s.dimensions) || {}, updatedAt: remote.updatedAt
      }));
    });
    localDimKeys.forEach(function(key){
      if(remoteDimKeys.indexOf(key) === -1) ops.push(db.collection("dimensions").doc(key).delete());
    });
    remoteDims.forEach(function(d){
      var payload = { label: d.label || "", green: d.green || "", red: d.red || "", order: d.order || 0 };
      if(d.statements) payload.statements = plainClone(d.statements);
      if(d.scoreBands) payload.scoreBands = plainClone(d.scoreBands);
      if(d.strategies) payload.strategies = plainClone(d.strategies);
      ops.push(db.collection("dimensions").doc(d.key).set(payload));
    });
    if(remote.config) ops.push(db.doc("meta/config").set(Object.assign({}, remote.config, { updatedAt: remote.updatedAt })));
    diag("Team sync: hydrating local board (" + remoteSquads.length + " squad(s), " + remoteDims.length + " dimension(s))");
    return Promise.all(ops);
  });
}

// Shared by both the one-shot boot-time hydrate below and the live
// subscription -- applies a remote board only if it's genuinely newer than
// what this device already knows about, so the live subscription's very
// first callback (which always fires immediately with current state, same
// as any onSnapshot) safely no-ops when it's just echoing what hydrate
// already applied a moment earlier.
//
// hydrate's one-shot fetch and the live subscription's own initial fire
// both resolve off the same room.ready promise, and a live "put" can also
// arrive while an earlier apply is still mid-flight (its own
// Promise.all(ops) writing several local docs isn't instant) -- so this
// CAN legitimately be called again before a previous call has finished.
// Running two applies concurrently would interleave their writes to the
// same local docs, and whichever happens to finish LAST wins regardless
// of which one actually held the newer data -- an older apply that
// started first but does slightly more work (e.g. deleting a squad) can
// finish after a newer, smaller one and silently regress the board. Found
// exactly this way, once board sync went default-on and a boot-time
// hydrate started regularly racing the live subscription for real.
// Serializing here (queue only the newest pending request, run it right
// after the current apply finishes) is what a real per-room mutex would
// give you, without needing one.
var pendingRemoteApply = null;

function maybeApplyRemote(roomId, remote){
  if(!remote || !remote.updatedAt) return Promise.resolve();
  var known = getSyncedAt(roomId);
  if(known && remote.updatedAt <= known) return Promise.resolve();

  if(hydrating){
    if(!pendingRemoteApply || remote.updatedAt > pendingRemoteApply.remote.updatedAt){
      pendingRemoteApply = { roomId: roomId, remote: remote };
    }
    return Promise.resolve();
  }

  hydrating = true;
  return applyRemoteBoardSnapshot(remote).then(function(){
    setSyncedAt(roomId, remote.updatedAt);
    hydrating = false;
    return runPendingRemoteApply();
  }, function(err){
    hydrating = false;
    runPendingRemoteApply();
    throw err;
  });
}
function runPendingRemoteApply(){
  if(!pendingRemoteApply) return;
  var next = pendingRemoteApply;
  pendingRemoteApply = null;
  return maybeApplyRemote(next.roomId, next.remote);
}

// Tracks which secret this device has already run a hydrate ATTEMPT for
// (successful or not) -- see pushBoardSnapshotIfConnected()'s guard below
// for why a push must wait for this. Deliberately keyed by the secret
// value itself, not a bare boolean: switching to a different team (a
// fresh Create, or Join-ing someone else's link) must require a fresh
// hydrate attempt for THAT secret before this device pushes anything to
// it, the same as the very first connection did.
var hydrateAttemptedForSecret = null;

function hydrateFromTeamIfConnected(){
  var secret = getTeamSecret();
  if(!secret || !state.db) return Promise.resolve();
  return SquadPulseCrypto.roomIdFor(secret).then(function(roomId){
    return state.db.doc(teamBoardPath(roomId), secret).get().then(function(snap){
      if(!snap.exists) return; // no device has pushed this team's board yet
      return maybeApplyRemote(roomId, snap.data());
    });
  }).catch(function(err){
    diag("Team sync hydrate failed: " + (err && err.code ? err.code : String(err)));
  }).then(function(){
    hydrateAttemptedForSecret = secret;
    // If hydrate found nothing to apply (a genuinely new team -- the
    // common "just created a link" case), no local write happened to
    // naturally re-trigger db.js's listeners, so nothing else would ever
    // retry the push pushBoardSnapshotIfConnected() skipped earlier while
    // this hydrate was still in flight. One explicit call here covers it;
    // it's a normal no-op via the same guards if there's nothing new to
    // push (e.g. hydrate DID apply something instead).
    pushBoardSnapshotIfConnected();
  });
}

// Keeps the relay connection for this team's board open and reacts to
// every future update another currently-open device pushes, live -- no
// reload needed. Reuses the exact same relay-client.js machinery retro
// sessions already rely on for this (one persistent WebSocket per room
// id); subscribing is what keeps that connection open for as long as this
// tab stays connected to this team.
var teamBoardUnsubscribe = null;

function subscribeToTeamBoardIfConnected(){
  stopTeamBoardSubscription();
  var secret = getTeamSecret();
  if(!secret || !state.db) return;
  SquadPulseCrypto.roomIdFor(secret).then(function(roomId){
    if(getTeamSecret() !== secret) return; // disconnected/switched while this was resolving
    teamBoardUnsubscribe = state.db.doc(teamBoardPath(roomId), secret).onSnapshot(function(snap){
      if(!snap.exists) return;
      maybeApplyRemote(roomId, snap.data()).catch(function(err){
        diag("Team sync live update failed: " + (err && err.code ? err.code : String(err)));
      });
    }, function(err){
      diag("Team sync subscription error: " + (err && err.code ? err.code : String(err)));
    });
  });
}
function stopTeamBoardSubscription(){
  if(teamBoardUnsubscribe){ teamBoardUnsubscribe(); teamBoardUnsubscribe = null; }
}

function connectWithSecret(secret){
  setTeamSecret(secret);
  renderTeamSyncStatus();
  diag("Team sync: connected");
  // Hydrate first (in case another device already has a newer board under
  // this link), THEN push -- so connecting doesn't blindly clobber an
  // existing team board with whatever this device happened to have locally.
  hydrateFromTeamIfConnected().then(function(){
    pushBoardSnapshotIfConnected();
    subscribeToTeamBoardIfConnected();
  });
}

function renderTeamSyncStatus(){
  var secret = getTeamSecret();
  var notConnected = document.getElementById("teamSyncNotConnected");
  var connected = document.getElementById("teamSyncConnected");
  var status = document.getElementById("teamSyncStatus");
  if(secret){
    notConnected.hidden = true;
    connected.hidden = false;
    status.textContent = t("admin.teamSync.connectedStatus");
    var link = teamLinkFor(secret);
    var linkInput = document.getElementById("teamLinkInput");
    if(linkInput) linkInput.value = link;
    var qrBox = document.getElementById("teamQr");
    if(qrBox) renderQrInto(qrBox, link);
  } else {
    notConnected.hidden = false;
    connected.hidden = true;
  }
}

document.getElementById("teamCreateBtn").addEventListener("click", function(){
  connectWithSecret(SquadPulseCrypto.generateSecret());
});
document.getElementById("teamJoinBtn").addEventListener("click", function(){
  var input = document.getElementById("teamJoinInput");
  var secret = parseTeamSecretInput(input ? input.value : "");
  if(!secret){ diag("Team sync: paste a team link first"); return; }
  connectWithSecret(secret);
  if(input) input.value = "";
});
document.getElementById("teamCopyLinkBtn").addEventListener("click", function(){
  var input = document.getElementById("teamLinkInput");
  if(!input) return;
  input.focus(); input.select();
  try{ navigator.clipboard && navigator.clipboard.writeText(input.value); }catch(e){ /* select() above still lets the user copy manually */ }
});
document.getElementById("teamDisconnectBtn").addEventListener("click", function(){
  diag("Team sync: disconnected");
  stopTeamBoardSubscription();
  setTeamSecret("");
  renderTeamSyncStatus();
});

renderTeamSyncStatus();

// Lets tests/unit/*.js exercise the pure parseTeamSecretInput() logic
// directly -- see tests/unit/README.md for why this pattern exists.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseTeamSecretInput: parseTeamSecretInput, teamLinkFor: teamLinkFor };
}
