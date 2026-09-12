"use strict";

// Step 3 of STATUS.md's "Board sync" plan: an opt-in, per-device "team
// code" setting. With none set, this whole file is inert and nothing about
// the app changes -- squads/dimensions/config stay purely local, exactly
// as before this file existed. Once a device connects with a team code,
// every board save (squad/dimension/config change, from any file) also
// pushes the CURRENT full board to boards/<teamCode> on the relay --
// encrypted with the same code-derived AES-256-GCM key sessions already
// use (see crypto.js), via the boards/* routing board-sync's earlier step
// (relay-client.js's isBoardPath) added.
//
// Step 4 adds the read side: hydrateFromTeamCodeIfConnected(), called once
// at boot (db.js's initDb()) before the squads/dimensions/config listeners
// register. Conflict rule is last-write-wins by the payload's own
// `updatedAt` timestamp (ISO 8601 strings compare correctly with plain `<`/
// `>`) -- simple, and good enough for now; a real merge is future work if
// this ever needs it. `getSyncedAt(code)`/`setSyncedAt(code, iso)` track,
// per team code, the newest `updatedAt` this device knows to already be on
// the relay (whether because IT pushed that version, or because it just
// hydrated it) -- that's what lets a device tell "the relay has something
// genuinely newer than what I already have" apart from "the relay has
// exactly what I just pushed a moment ago" (which would otherwise look
// identical from a bare existence check).
//
// Still no live/real-time sync -- hydration is a one-shot fetch on boot,
// not a subscription (that's step 5). Two devices open at once won't see
// each other's mid-session edits yet.

var TEAM_CODE_KEY = "squadpulse:teamCode";

function getTeamCode(){
  try{ return localStorage.getItem(TEAM_CODE_KEY) || ""; }catch(e){ return ""; }
}
function setTeamCode(code){
  try{
    if(code) localStorage.setItem(TEAM_CODE_KEY, code);
    else localStorage.removeItem(TEAM_CODE_KEY);
  }catch(e){ /* storage unavailable -- team sync just won't persist across reloads on this device */ }
}
// Mirrors how a session code already reads (short, uppercase, alnum) --
// not slugify()'s hyphenated-lowercase shape, which is meant for filenames
// and template ids, not a code someone types on a second device.
function normalizeTeamCode(raw){
  return String(raw||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,40);
}

function syncedAtKeyFor(code){ return "squadpulse:teamCode:syncedAt:" + code; }
function getSyncedAt(code){
  try{ return localStorage.getItem(syncedAtKeyFor(code)) || ""; }catch(e){ return ""; }
}
function setSyncedAt(code, iso){
  try{ localStorage.setItem(syncedAtKeyFor(code), iso); }catch(e){ /* ditto -- worst case, a later hydrate re-checks against nothing and just re-applies */ }
}

function boardSnapshotPayload(){
  return { squads: state.squads, dimensions: state.dimensions, config: state.config, updatedAt: nowIso() };
}

// While a hydrate-triggered rewrite of local squad/dimension/config docs is
// in flight, the very same db.js listeners that normally trigger a push
// would otherwise fire once per doc touched, each pushing back an
// only-partially-applied intermediate board. Suppressing pushes for that
// one window means the relay only ever sees either the pre-hydrate or the
// fully post-hydrate board, never something in between.
var hydrating = false;

function pushBoardSnapshotIfConnected(){
  if(hydrating) return;
  var code = getTeamCode();
  if(!code || !state.db) return;
  var payload = boardSnapshotPayload();
  state.db.doc("boards/" + code).set(payload).then(function(){
    setSyncedAt(code, payload.updatedAt);
  }).catch(function(err){
    diag("Team sync push failed: " + (err && err.code ? err.code : String(err)));
  });
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
        name: s.name || "Untitled squad", order: s.order || 0, dimensions: s.dimensions || {}, updatedAt: remote.updatedAt
      }));
    });
    localDimKeys.forEach(function(key){
      if(remoteDimKeys.indexOf(key) === -1) ops.push(db.collection("dimensions").doc(key).delete());
    });
    remoteDims.forEach(function(d){
      var payload = { label: d.label || "", green: d.green || "", red: d.red || "", order: d.order || 0 };
      if(d.statements) payload.statements = d.statements;
      if(d.scoreBands) payload.scoreBands = d.scoreBands;
      if(d.strategies) payload.strategies = d.strategies;
      ops.push(db.collection("dimensions").doc(d.key).set(payload));
    });
    if(remote.config) ops.push(db.doc("meta/config").set(Object.assign({}, remote.config, { updatedAt: remote.updatedAt })));
    diag("Team sync: hydrating local board from boards/" + getTeamCode() + " (" + remoteSquads.length + " squad(s), " + remoteDims.length + " dimension(s))");
    return Promise.all(ops);
  });
}

// Shared by both the one-shot boot-time hydrate below and the live
// subscription (step 5) -- applies a remote board only if it's genuinely
// newer than what this device already knows about, so the live
// subscription's very first callback (which always fires immediately with
// whatever's already there, same as any onSnapshot) safely no-ops when
// it's just echoing what hydrate already applied a moment earlier.
function maybeApplyRemote(remote){
  if(!remote || !remote.updatedAt) return Promise.resolve();
  var code = getTeamCode();
  var known = getSyncedAt(code);
  if(known && remote.updatedAt <= known) return Promise.resolve();
  hydrating = true;
  return applyRemoteBoardSnapshot(remote).then(function(){
    setSyncedAt(code, remote.updatedAt);
    hydrating = false;
  }, function(err){
    hydrating = false;
    throw err;
  });
}

function hydrateFromTeamCodeIfConnected(){
  var code = getTeamCode();
  if(!code || !state.db) return Promise.resolve();
  return state.db.doc("boards/" + code).get().then(function(snap){
    if(!snap.exists) return; // no device has pushed this team code's board yet
    return maybeApplyRemote(snap.data());
  }).catch(function(err){
    diag("Team sync hydrate failed: " + (err && err.code ? err.code : String(err)));
  });
}

// Step 5 of STATUS.md's "Board sync" plan: unlike hydrateFromTeamCodeIfConnected()
// (a one-shot fetch, only ever checked again on the next boot or reconnect),
// this keeps the relay connection for boards/<teamCode> open and reacts to
// every future update another currently-open device pushes, live -- no
// reload needed. Reuses the exact same relay-client.js machinery retro
// sessions already rely on for this (one persistent WebSocket per room
// code); subscribing is what keeps that connection open for as long as
// this tab stays on this team code.
var teamBoardUnsubscribe = null;

function subscribeToTeamBoardIfConnected(){
  stopTeamBoardSubscription();
  var code = getTeamCode();
  if(!code || !state.db) return;
  teamBoardUnsubscribe = state.db.doc("boards/" + code).onSnapshot(function(snap){
    if(!snap.exists) return;
    maybeApplyRemote(snap.data()).catch(function(err){
      diag("Team sync live update failed: " + (err && err.code ? err.code : String(err)));
    });
  }, function(err){
    diag("Team sync subscription error: " + (err && err.code ? err.code : String(err)));
  });
}
function stopTeamBoardSubscription(){
  if(teamBoardUnsubscribe){ teamBoardUnsubscribe(); teamBoardUnsubscribe = null; }
}

function renderTeamSyncStatus(){
  var code = getTeamCode();
  var input = document.getElementById("teamCodeInput");
  var connectBtn = document.getElementById("teamCodeConnectBtn");
  var disconnectBtn = document.getElementById("teamCodeDisconnectBtn");
  var status = document.getElementById("teamSyncStatus");
  if(code){
    input.value = code;
    input.disabled = true;
    connectBtn.hidden = true;
    disconnectBtn.hidden = false;
    status.textContent = "Connected — this device's board changes push to team code " + code + ".";
  } else {
    input.value = "";
    input.disabled = false;
    connectBtn.hidden = false;
    disconnectBtn.hidden = true;
    status.textContent = "Not connected — this board stays local to this device only.";
  }
}

document.getElementById("teamCodeConnectBtn").addEventListener("click", function(){
  var code = normalizeTeamCode(document.getElementById("teamCodeInput").value);
  if(!code){ diag("Team sync: enter a team code first"); return; }
  setTeamCode(code);
  renderTeamSyncStatus();
  diag("Team sync: connected to team code " + code);
  // Hydrate first (in case another device already has a newer board under
  // this code), THEN push -- so connecting doesn't blindly clobber an
  // existing team board with whatever this device happened to have locally.
  hydrateFromTeamCodeIfConnected().then(function(){
    pushBoardSnapshotIfConnected();
    subscribeToTeamBoardIfConnected();
  });
});
document.getElementById("teamCodeDisconnectBtn").addEventListener("click", function(){
  diag("Team sync: disconnected from team code " + getTeamCode());
  stopTeamBoardSubscription();
  setTeamCode("");
  renderTeamSyncStatus();
});

renderTeamSyncStatus();

// Lets tests/unit/*.js exercise the pure normalizeTeamCode() logic directly
// -- see tests/unit/README.md for why this pattern exists.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeTeamCode: normalizeTeamCode };
}
