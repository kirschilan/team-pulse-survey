"use strict";


// ---------- squad CRUD ----------
function renameSquad(id, name){
  var sq = findSquad(id);
  if(!sq) return;
  sq.name = name;
  renderAll();
  syncLiveIfConnected(function(){
    return state.db.collection("squads").doc(id).update({ name:name, updatedAt: nowIso() });
  }, "Rename squad " + id);
}

function removeSquad(id){
  state.squads = state.squads.filter(function(s){ return s.id!==id; });
  renderAll();
  syncLiveIfConnected(function(){
    return state.db.collection("squads").doc(id).delete();
  }, "Remove squad " + id);
}

function addSquad(){
  var maxOrder = state.squads.reduce(function(m,s){ return Math.max(m, s.order||0); }, 0);
  var name = "New " + unitLower();
  liveOr(function(){
    // don't also push a local copy here -- the live squads listener below
    // delivers this same write back immediately (latency-compensated) and
    // fully replaces state.squads, so pushing too would show a duplicate row
    return state.db.collection("squads").add({ name:name, order:maxOrder+1, dimensions:{}, updatedAt: nowIso() })
      .catch(function(err){ diag("Add squad failed: " + (err && err.code ? err.code : String(err))); });
  }, function(){
    state.squads.push({ id:"local-"+Date.now(), name:name, order:maxOrder+1, dimensions:{} });
    renderAll();
  });
}
document.getElementById("addSquadBtn").addEventListener("click", addSquad);

// ---------- admin: squad management ----------
// Structural squad changes (add/rename/remove) live here now, separate from
// both rating entry (Squad view) and the read-only Tribe grid.
function renderAdminSquadList(){
  var squads = sortedSquads();
  var html = squads.map(function(sq){
    return '<div class="tpl-row" data-id="'+esc(sq.id)+'">' +
      '<div class="tinfo">' +
        '<input class="dim-label admin-squad-name" data-id="'+esc(sq.id)+'" value="'+esc(sq.name)+'" aria-label="'+esc(unitLower())+' name" dir="auto">' +
      '</div>' +
      '<button class="icon-btn danger admin-squad-del" data-id="'+esc(sq.id)+'" title="Remove '+esc(unitLower())+'" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
    '</div>';
  }).join("");
  document.getElementById("adminSquadList").innerHTML = html || '<p class="hint" style="margin:0;">No '+unitPluralLower()+' yet — add one below.</p>';
  document.querySelectorAll(".admin-squad-name").forEach(function(input){
    input.addEventListener("change", function(){
      renameSquad(input.getAttribute("data-id"), input.value.trim() || "Untitled " + unitLower());
    });
  });
  document.querySelectorAll(".admin-squad-del").forEach(function(btn){
    btn.addEventListener("click", function(){
      var id = btn.getAttribute("data-id");
      var sq = findSquad(id);
      openConfirm(
        "Remove " + unitLower() + "?",
        "Remove “" + (sq ? sq.name : "this " + unitLower()) + "”? Its ratings go with it.",
        function(){ removeSquad(id); },
        "Remove"
      );
    });
  });
}

// ---------- squad view ----------
// Each squad's own entry point: pick your squad, rate your own dimensions,
// see your own hotspots. Deliberately shows nothing about other squads --
// that comparison lives in Tribe view instead.
function selectSquad(id){
  state.ui.selectedSquadId = id;
  try{ localStorage.setItem("squadpulse:squad", id); }catch(e){ /* per-viewer convenience only */ }
  renderSquadView();
}

function renderSquadPicker(){
  var squads = sortedSquads();
  var html = squads.map(function(sq){
    return '<button class="btn squad-pick-btn'+(sq.id===state.ui.selectedSquadId?" active":"")+'" data-id="'+esc(sq.id)+'" type="button" dir="auto">'+esc(sq.name)+'</button>';
  }).join("");
  document.getElementById("squadPicker").innerHTML = html || '<p class="hint" style="margin:0;">No '+unitPluralLower()+' yet — ask an admin to add one.</p>';
  document.querySelectorAll(".squad-pick-btn").forEach(function(btn){
    btn.addEventListener("click", function(){ selectSquad(btn.getAttribute("data-id")); });
  });
}

function renderSquadDetailHtml(sq){
  var dims = sortedDimensions();
  var r = squadScore(sq);
  var hotspots = dims.filter(function(d){
    var cell = sq.dimensions && sq.dimensions[d.key];
    return cell && (cell.color==="crit" || cell.color==="warn");
  }).sort(function(a,b){
    var ca = (sq.dimensions[a.key]||{}).color, cb = (sq.dimensions[b.key]||{}).color;
    return (cb==="crit"?2:cb==="warn"?1:0) - (ca==="crit"?2:ca==="warn"?1:0);
  });
  var hotspotHtml = hotspots.length
    ? hotspots.map(function(d){
        var cell = sq.dimensions[d.key];
        return '<div class="hotspot-row"><div class="hd"><span class="dim" dir="auto">'+esc(d.label)+'</span>' +
          '<span class="cnt">'+(cell.color==="crit"?"Red":"Yellow")+'</span></div></div>';
      }).join("")
    : '<p class="hint" style="margin:0;">Nothing red or yellow right now &mdash; nice work.</p>';

  var entryHtml = dims.length ? '<div class="entry-list">' + dims.map(function(d){
    var cell = (sq.dimensions && sq.dimensions[d.key]) || {};
    var color = cell.color || "unscored";
    var trend = cell.trend;
    var hasNote = cell.note && cell.note.trim().length>0;
    var showTrend = trend==="up" || trend==="down";
    return '<div class="entry-row">' +
      '<div class="entry-info">' +
        '<div class="entry-label" dir="auto">'+esc(d.label)+'</div>' +
        '<div class="entry-desc" dir="auto"><span class="tip-dot good"></span><span>'+esc(d.green||"")+'</span></div>' +
        '<div class="entry-desc" dir="auto"><span class="tip-dot crit"></span><span>'+esc(d.red||"")+'</span></div>' +
      '</div>' +
      '<button class="cell-btn '+color+'" data-squad="'+esc(sq.id)+'" data-dim="'+esc(d.key)+'" type="button" ' +
        'aria-label="'+esc(d.label)+': '+colorWord(color)+trendWord(trend, true)+'">' +
        markIcon(color) +
        (showTrend ? '<span class="trend-badge '+trend+'" title="'+trendWord(trend)+'">'+trendIcon(trend)+'</span>' : '') +
        (hasNote ? '<span class="note-dot" title="Has a note"></span>' : '') +
      '</button>' +
    '</div>';
  }).join("") + '</div>' : '<p class="hint" style="margin:0;">No dimensions yet &mdash; ask an admin to set some up.</p>';

  return (
    '<div class="heatmap-head">' +
      '<div>' +
        '<h2 style="font-size:18px;" dir="auto">'+esc(sq.name)+'</h2>' +
        '<p class="squad-score-line">'+r.score+' pts &middot; '+r.scored+'/'+r.total+' scored</p>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin:14px 0;">' +
      '<h2>Your hotspots</h2>' +
      '<p class="hint">Where '+esc(sq.name)+' is flagged red or yellow right now.</p>' +
      hotspotHtml +
    '</div>' +
    entryHtml
  );
}

function renderSquadView(){
  renderSquadPicker();
  var container = document.getElementById("squadDetail");
  var sq = state.ui.selectedSquadId ? findSquad(state.ui.selectedSquadId) : null;
  if(!sq){
    container.innerHTML = '<p class="squad-empty">Select your '+unitLower()+' above to enter or review its ratings.</p>';
    return;
  }
  container.innerHTML = renderSessionCardHtml(sq) + renderSquadDetailHtml(sq);
  container.querySelectorAll(".cell-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      openEditor(btn.getAttribute("data-squad"), btn.getAttribute("data-dim"));
    });
  });
  bindSessionCardEvents(sq);
}

// Writes one or more of a squad's dimension ratings to the live board in a
// single update -- persistDimensionRating(sq, key) is the common single
// -dimension case; persistDimensionRatings(sq, keys) is used when finishing
// a retro (Story 9) writes several consolidated results at once, so they
// land together rather than as separate round-trips.
function persistDimensionRating(sq, dimKey){ persistDimensionRatings(sq, [dimKey]); }

function persistDimensionRatings(sq, dimKeys){
  if(!(state.live && state.db)) { diag("Persist skipped: not connected to live storage (state.live=" + state.live + ")"); return; }
  try{
    var patch = { dimensions:{}, updatedAt: nowIso() };
    dimKeys.forEach(function(k){ patch.dimensions[k] = sq.dimensions[k]; });
    diag("Writing squads/" + sq.id + " (" + dimKeys.length + " dim(s))...");
    state.db.collection("squads").doc(sq.id).update(patch).then(function(){
      diag("Write CONFIRMED for squads/" + sq.id);
    }).catch(function(err){
      diag("Write REJECTED for squads/" + sq.id + ": " + (err && err.code ? err.code : String(err)) + (err && err.message ? " - " + err.message : ""));
      if(err && err.code==="invalid_argument"){
        // document might not exist yet (rare race) -- create it whole
        state.db.collection("squads").doc(sq.id).set(Object.assign({name:sq.name, order:sq.order||0}, {dimensions:sq.dimensions}))
          .then(function(){ diag("Fallback set() succeeded for squads/" + sq.id); })
          .catch(function(err2){ diag("Fallback set() ALSO failed for squads/" + sq.id + ": " + (err2 && err2.code ? err2.code : String(err2))); });
      }
    });
  } catch(err){
    diag("Persist threw synchronously: " + (err && err.message ? err.message : String(err)));
  }
}
