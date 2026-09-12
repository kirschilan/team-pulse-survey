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

function getTeamSecret(){
  try{ return localStorage.getItem(TEAM_SECRET_KEY) || ""; }catch(e){ return ""; }
}
function setTeamSecret(secret){
  try{
    if(secret) localStorage.setItem(TEAM_SECRET_KEY, secret);
    else localStorage.removeItem(TEAM_SECRET_KEY);
  }catch(e){ /* storage unavailable -- team sync just won't persist across reloads on this device */ }
}
function teamLinkFor(secret){
  return window.location.origin + window.location.pathname + "?team=" + encodeURIComponent(secret);
}
// Accepts either a bare secret or a full team link someone pasted (the
// input takes both, so "paste the link you were sent" and "the link
// worked and you're just re-entering it" both just work).
function parseTeamSecretInput(raw){
  raw = String(raw||"").trim();
  if(!raw) return "";
  try{
    var url = new URL(raw, window.location.href);
    var fromLink = url.searchParams.get("team");
    if(fromLink) return fromLink;
  }catch(e){ /* not a URL -- fall through and treat it as a bare secret */ }
  return raw;
}

// Opening a real team link (?team=<secret>) persists it to this device
// immediately, then strips it from the visible URL/history -- the same
// hygiene a magic-link auth flow uses, so the secret doesn't linger in
// browser history or get echoed in a Referer header on the next click.
(function autoConnectFromLink(){
  var fromUrl = getQueryParam("team");
  if(!fromUrl || fromUrl === getTeamSecret()) return;
  setTeamSecret(fromUrl);
  try{
    var url = new URL(window.location.href);
    url.searchParams.delete("team");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }catch(e){ /* history API unavailable -- the param just stays visible, harmless */ }
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

// While a hydrate-triggered rewrite of local squad/dimension/config docs is
// in flight, the very same db.js listeners that normally trigger a push
// would otherwise fire once per doc touched, each pushing back an
// only-partially-applied intermediate board. Suppressing pushes for that
// one window means the relay only ever sees either the pre-hydrate or the
// fully post-hydrate board, never something in between.
var hydrating = false;

function pushBoardSnapshotIfConnected(){
  if(hydrating) return;
  var secret = getTeamSecret();
  if(!secret || !state.db) return;
  SquadPulseCrypto.roomIdFor(secret).then(function(roomId){
    var payload = boardSnapshotPayload();
    return state.db.doc(teamBoardPath(roomId), secret).set(payload).then(function(){
      setSyncedAt(roomId, payload.updatedAt);
    });
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
function maybeApplyRemote(roomId, remote){
  if(!remote || !remote.updatedAt) return Promise.resolve();
  var known = getSyncedAt(roomId);
  if(known && remote.updatedAt <= known) return Promise.resolve();
  hydrating = true;
  return applyRemoteBoardSnapshot(remote).then(function(){
    setSyncedAt(roomId, remote.updatedAt);
    hydrating = false;
  }, function(err){
    hydrating = false;
    throw err;
  });
}

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
    status.textContent = "Connected — this device stays in sync, live, with every other device using this link.";
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
