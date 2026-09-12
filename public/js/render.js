"use strict";


function renderAll(){
  renderHeader();
  renderStats();
  renderRanking();
  renderHotspots();
  renderGrid();
  renderLegend();
  renderSquadView();
  renderAdminSquadList();
}

function renderHeader(){
  document.getElementById("tagline").textContent =
    "A fast, visual health snapshot across your " + unitPluralLower() +
    " — so you can see at a glance where things are strong and where to invest next.";
  var badge = document.getElementById("modelBadge");
  if(state.config.activeTemplateName){
    badge.hidden = false;
    badge.textContent = state.config.activeTemplateName;
  } else {
    badge.hidden = true;
  }
  document.getElementById("statAssessedLabel").textContent = state.config.unitPlural + " assessed";
  document.getElementById("addSquadBtn").textContent = "+ Add " + unitLower();
}

function renderStats(){
  var squads = sortedSquads();
  var dims = sortedDimensions();
  var n = squads.length;
  var totalScored=0, totalRisk=0;
  var dimReds = {}; dims.forEach(function(d){ dimReds[d.key]=0; });
  squads.forEach(function(sq){
    var r = squadScore(sq);
    totalScored += r.scored;
    totalRisk += r.counts.crit;
    dims.forEach(function(d){
      var cell = sq.dimensions && sq.dimensions[d.key];
      if(cell && cell.color==="crit") dimReds[d.key]++;
    });
  });
  var avgScored = n ? (totalScored / n) : 0;
  document.getElementById("statAssessed").textContent = (n && dims.length) ? (avgScored.toFixed(1)+" / "+dims.length) : "—";
  document.getElementById("statAssessedSub").textContent = n + " " + (n===1 ? unitLower() : unitPluralLower()) + " tracked";
  document.getElementById("statRisk").textContent = totalRisk;

  var topKey=null, topVal=-1;
  dims.forEach(function(d){ if(dimReds[d.key] > topVal){ topVal = dimReds[d.key]; topKey = d.key; } });
  var hotEl = document.getElementById("statHotspot");
  var hotSub = document.getElementById("statHotspotSub");
  if(topVal > 0){
    hotEl.textContent = dimByKey(topKey).label;
    hotSub.textContent = topVal + " of " + n + " " + unitPluralLower() + " flagged this red";
  } else {
    hotEl.textContent = "None yet";
    hotSub.textContent = "no dimension is red across multiple " + unitPluralLower();
  }
}

function renderRanking(){
  var squads = sortedSquads().map(function(sq){ return { sq:sq, r:squadScore(sq) }; });
  squads.sort(function(a,b){ return b.r.score - a.r.score; });
  var maxPossible = Math.max(1, state.dimensions.length * 2);
  var maxScore = Math.max(maxPossible, squads.reduce(function(m,s){ return Math.max(m,s.r.score); },0));
  var html = squads.map(function(item,i){
    var sq=item.sq, r=item.r;
    var pct = Math.round((r.score/maxScore)*100);
    return '<div class="rank-row">' +
      '<span class="n">'+(i+1)+'</span>' +
      '<span class="name" dir="auto">'+esc(sq.name)+'</span>' +
      '<span class="score">'+r.score+' pts</span>' +
      '<div class="bar-wrap">' +
        '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%"></div></div>' +
        '<span class="breakdown">'+r.counts.crit+' red &middot; '+r.counts.warn+' yellow</span>' +
      '</div>' +
    '</div>';
  }).join("");
  document.getElementById("rankList").innerHTML = html || '<p class="hint" style="margin:0;">Add a '+unitLower()+' to get started.</p>';
}

function renderHotspots(){
  var squads = sortedSquads();
  var dims = sortedDimensions();
  var n = squads.length || 1;
  var rows = dims.map(function(d){
    var counts = {good:0,warn:0,crit:0,unscored:0};
    squads.forEach(function(sq){
      var cell = sq.dimensions && sq.dimensions[d.key];
      var color = cell && cell.color ? cell.color : "unscored";
      counts[color]++;
    });
    var weightScore = counts.crit*2 + counts.warn;
    return { d:d, counts:counts, weightScore:weightScore };
  });
  rows.sort(function(a,b){ return b.weightScore - a.weightScore; });
  rows = rows.slice(0,6);
  var html = rows.map(function(row){
    var c = row.counts;
    var segs = [];
    if(c.crit) segs.push('<span style="flex:'+c.crit+';background:var(--crit)"></span>');
    if(c.warn) segs.push('<span style="flex:'+c.warn+';background:var(--warn)"></span>');
    if(c.good) segs.push('<span style="flex:'+c.good+';background:var(--good)"></span>');
    if(c.unscored) segs.push('<span style="flex:'+c.unscored+';background:var(--unscored)"></span>');
    return '<div class="hotspot-row">' +
      '<div class="hd"><span class="dim" dir="auto">'+esc(row.d.label)+'</span><span class="cnt">'+c.crit+' red / '+n+'</span></div>' +
      '<div class="stackbar">'+segs.join("")+'</div>' +
    '</div>';
  }).join("");
  document.getElementById("hotspotList").innerHTML = html || '<p class="hint" style="margin:0;">Score a few '+unitPluralLower()+' to see patterns emerge.</p>';
}

// Tribe view's grid is READ-ONLY: renaming/removing squads is now an Admin
// action, and entering ratings is now done per-squad from Squad view. This
// keeps the shared, transparent detail available (nothing is technically
// hidden -- it's just collapsed by default and not editable from here) --
// see the "Squad-by-squad breakdown" <details> it lives inside.
function renderGrid(){
  var squads = sortedSquads();
  var dims = sortedDimensions();
  if(dims.length===0){
    document.getElementById("gridTable").innerHTML =
      '<tbody><tr><td class="empty-grid">No dimensions yet. Add one from Admin, or load a template.</td></tr></tbody>';
    return;
  }
  var thead = '<thead><tr><th class="corner"></th>' +
    dims.map(function(d){
      return '<th><span class="dim-th-label" tabindex="0" data-dim-key="'+esc(d.key)+'" dir="auto">'+esc(d.label)+'</span></th>';
    }).join("") +
    '</tr></thead>';
  var tbody = '<tbody>' + squads.map(function(sq){
    var r = squadScore(sq);
    var cells = dims.map(function(d){
      var cell = (sq.dimensions && sq.dimensions[d.key]) || {};
      var color = cell.color || "unscored";
      var trend = cell.trend;
      var hasNote = cell.note && cell.note.trim().length>0;
      var showTrend = trend==="up" || trend==="down";
      return '<td>' +
        '<div class="cell-btn '+color+'" role="img" data-squad="'+esc(sq.id)+'" data-dim="'+esc(d.key)+'" ' +
        'aria-label="'+esc(sq.name)+' &middot; '+esc(d.label)+': '+colorWord(color)+trendWord(trend, true)+'">' +
          markIcon(color) +
          (showTrend ? '<span class="trend-badge '+trend+'" title="'+trendWord(trend)+'">'+trendIcon(trend)+'</span>' : '') +
          (hasNote ? '<span class="note-dot" title="Has a note"></span>' : '') +
        '</div>' +
      '</td>';
    }).join("");
    return '<tr>' +
      '<th><div class="squad-row">' +
        '<span class="squad-name" dir="auto">'+esc(sq.name)+'</span>' +
      '</div>' +
      '<div class="squad-meta" style="margin-top:4px;padding-left:6px;">' +
        '<span class="score-chip">'+r.score+' pts &middot; '+r.scored+'/'+r.total+' scored</span>' +
      '</div></th>' +
      cells +
    '</tr>';
  }).join("") + '</tbody>';
  document.getElementById("gridTable").innerHTML = thead + tbody;
  bindGridHeaderTooltips();
}

function renderLegend(){
  var dims = sortedDimensions();
  document.getElementById("legendSummary").innerHTML =
    "How to read the " + dims.length + " dimension" + (dims.length===1?"":"s") +
    ' <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>';
  var html = dims.map(function(d){
    return '<div class="legend-item">' +
      '<div class="lh" dir="auto"><span class="dot"></span>'+esc(d.label)+'</div>' +
      '<p dir="auto"><b>Green:</b> '+esc(d.green)+'</p>' +
      '<p dir="auto"><b>Red:</b> '+esc(d.red)+'</p>' +
    '</div>';
  }).join("");
  document.getElementById("legendGrid").innerHTML = html || '<p class="hint" style="margin:0;">No dimensions defined yet.</p>';
  document.getElementById("legendAttrib").textContent = state.config.attribution ||
    "Dimensions are fully custom to this board — manage them any time via Edit dimensions or Templates.";
}

// ---------- grid interactions ----------
// (Squad renaming/removal now lives in Admin; rating entry now lives in
// Squad view -- the only remaining interaction inside the read-only Tribe
// grid is the dimension header tooltip.)
function bindGridHeaderTooltips(){
  document.querySelectorAll(".dim-th-label").forEach(function(label){
    label.addEventListener("mouseenter", function(){ showDimTooltip(label); });
    label.addEventListener("mouseleave", hideDimTooltip);
    label.addEventListener("focus", function(){ showDimTooltip(label); });
    label.addEventListener("blur", hideDimTooltip);
  });
}

// ---------- dimension header tooltip ----------
// Positioned via JS (rather than pure-CSS :hover) and appended outside the
// grid's own scroll container, so it isn't clipped by .table-scroll's
// overflow-x:auto (which forces overflow-y to a clipping value too) and
// shows up immediately instead of relying on the slow, easy-to-miss native
// title-attribute tooltip.
var dimTooltipEl = document.getElementById("dimTooltip");
function showDimTooltip(label){
  var d = dimByKey(label.getAttribute("data-dim-key"));
  if(!d) return;
  dimTooltipEl.innerHTML =
    '<div class="tip-title" dir="auto">'+esc(d.label)+'</div>' +
    '<div class="tip-row"><span class="tip-dot good"></span><span dir="auto">'+esc(d.green || "No description yet")+'</span></div>' +
    '<div class="tip-row"><span class="tip-dot crit"></span><span dir="auto">'+esc(d.red || "No description yet")+'</span></div>';
  dimTooltipEl.hidden = false;
  var lr = label.getBoundingClientRect();
  var tr = dimTooltipEl.getBoundingClientRect();
  var left = lr.left + lr.width/2 - tr.width/2;
  left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
  var top = lr.top - tr.height - 10;
  if(top < 8) top = lr.bottom + 10; // flip below if there's no room above
  dimTooltipEl.style.left = left + "px";
  dimTooltipEl.style.top = top + "px";
}
function hideDimTooltip(){ dimTooltipEl.hidden = true; }
