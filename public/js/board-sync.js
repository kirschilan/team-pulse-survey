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
// Deliberately one-way for now: this only covers WRITES going out. Nothing
// here reads a team code's board back in -- that's hydrate-on-load, the
// next step in the plan -- so connecting a second device to the same team
// code today does not yet make it see the first device's board; it only
// proves this device's own changes really do reach the relay.

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

function boardSnapshotPayload(){
  return { squads: state.squads, dimensions: state.dimensions, config: state.config, updatedAt: nowIso() };
}

function pushBoardSnapshotIfConnected(){
  var code = getTeamCode();
  if(!code || !state.db) return;
  state.db.doc("boards/" + code).set(boardSnapshotPayload()).catch(function(err){
    diag("Team sync push failed: " + (err && err.code ? err.code : String(err)));
  });
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
  pushBoardSnapshotIfConnected();
});
document.getElementById("teamCodeDisconnectBtn").addEventListener("click", function(){
  diag("Team sync: disconnected from team code " + getTeamCode());
  setTeamCode("");
  renderTeamSyncStatus();
});

renderTeamSyncStatus();

// Lets tests/unit/*.js exercise the pure normalizeTeamCode() logic directly
// -- see tests/unit/README.md for why this pattern exists.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeTeamCode: normalizeTeamCode };
}
