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
  document.getElementById("tagline").textContent = t("header.tagline", { unitPlural: unitPluralLower() });
  var badge = document.getElementById("modelBadge");
  if(state.config.activeTemplateName){
    badge.hidden = false;
    badge.textContent = state.config.activeTemplateName;
  } else {
    badge.hidden = true;
  }
  document.getElementById("statAssessedLabel").textContent = t("tribe.stats.assessedLabel", { unitPlural: state.config.unitPlural });
  document.getElementById("addSquadBtn").textContent = t("admin.squads.addButton", { unit: unitLower() });
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
  document.getElementById("statAssessedSub").textContent = t("tribe.stats.assessedSub", { countUnit: n + " " + (n===1 ? unitLower() : unitPluralLower()) });
  document.getElementById("statRisk").textContent = totalRisk;

  var topKey=null, topVal=-1;
  dims.forEach(function(d){ if(dimReds[d.key] > topVal){ topVal = dimReds[d.key]; topKey = d.key; } });
  var hotEl = document.getElementById("statHotspot");
  var hotSub = document.getElementById("statHotspotSub");
  if(topVal > 0){
    hotEl.textContent = localizedDimText(dimByKey(topKey), "label");
    hotSub.textContent = t("tribe.stats.hotspotSubFlagged", { count: topVal, totalUnit: n + " " + unitPluralLower() });
  } else {
    hotEl.textContent = t("tribe.stats.hotspotNone");
    hotSub.textContent = t("tribe.stats.hotspotSubNone", { unitPlural: unitPluralLower() });
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
      '<span class="score">'+esc(t("common.ptsOnly", {score: r.score}))+'</span>' +
      '<div class="bar-wrap">' +
        '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%"></div></div>' +
        '<span class="breakdown">'+esc(t("common.breakdownLine", {crit: r.counts.crit, warn: r.counts.warn}))+'</span>' +
      '</div>' +
    '</div>';
  }).join("");
  document.getElementById("rankList").innerHTML = html || '<p class="hint" style="margin:0;">'+esc(t("tribe.ranking.empty", {unit: unitLower()}))+'</p>';
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
      '<div class="hd"><span class="dim" dir="auto">'+esc(localizedDimText(row.d, "label"))+'</span><span class="cnt">'+esc(t("tribe.hotspots.countLine", {crit: c.crit, total: n}))+'</span></div>' +
      '<div class="stackbar">'+segs.join("")+'</div>' +
    '</div>';
  }).join("");
  document.getElementById("hotspotList").innerHTML = html || '<p class="hint" style="margin:0;">'+esc(t("tribe.hotspots.empty", {unitPlural: unitPluralLower()}))+'</p>';
}

// Tribe view's grid is READ-ONLY: renaming/removing squads is now an Admin
// action, and entering ratings is now done per-squad from Squad view. This
// keeps the shared, transparent detail available (nothing is technically
// hidden -- it's just collapsed by default and not editable from here) --
// see the "Squad-by-squad breakdown" <details> it lives inside.
function renderGrid(){
  // Real bug, reported from usage: this function replaces the whole header
  // via one innerHTML write below, which destroys whatever .dim-th-label
  // node an open tooltip's mouseleave listener is attached to -- removing
  // an element never synthesizes a mouseleave for it, so a tooltip left
  // open when a re-render happens (a teammate's live edit, a rating save,
  // a language switch, ...) got stuck showing forever. Unconditionally
  // hiding it before the rebuild is a no-op when nothing was open.
  hideDimTooltip();
  var squads = sortedSquads();
  var dims = sortedDimensions();
  if(dims.length===0){
    document.getElementById("gridTable").innerHTML =
      '<tbody><tr><td class="empty-grid">'+esc(t("tribe.grid.empty"))+'</td></tr></tbody>';
    return;
  }
  var thead = '<thead><tr><th class="corner"></th>' +
    dims.map(function(d){
      return '<th><span class="dim-th-label" tabindex="0" data-dim-key="'+esc(d.key)+'" dir="auto">'+esc(localizedDimText(d, "label"))+'</span></th>';
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
        'aria-label="'+esc(sq.name)+' &middot; '+esc(localizedDimText(d, "label"))+': '+esc(colorWordLocalized(color)+trendWordLocalized(trend, true))+'">' +
          markIcon(color) +
          (showTrend ? '<span class="trend-badge '+trend+'" title="'+esc(trendWordLocalized(trend))+'">'+trendIcon(trend)+'</span>' : '') +
          (hasNote ? '<span class="note-dot" title="'+esc(t("common.hasNoteTitle"))+'"></span>' : '') +
        '</div>' +
      '</td>';
    }).join("");
    return '<tr>' +
      '<th><div class="squad-row">' +
        '<span class="squad-name" dir="auto">'+esc(sq.name)+'</span>' +
      '</div>' +
      '<div class="squad-meta" style="margin-top:4px;padding-left:6px;">' +
        '<span class="score-chip">'+esc(t("common.scoreLine", {score: r.score, fraction: r.scored + "/" + r.total}))+'</span>' +
      '</div></th>' +
      cells +
    '</tr>';
  }).join("") + '</tbody>';
  document.getElementById("gridTable").innerHTML = thead + tbody;
}

function renderLegend(){
  var dims = sortedDimensions();
  document.getElementById("legendSummary").innerHTML =
    esc(dims.length===1 ? t("tribe.legend.summaryOne") : t("tribe.legend.summaryMany", {count: dims.length})) +
    ' <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>';
  var html = dims.map(function(d){
    return '<div class="legend-item">' +
      '<div class="lh" dir="auto"><span class="dot"></span>'+esc(localizedDimText(d, "label"))+'</div>' +
      '<p><b>'+esc(t("tribe.legend.greenLabel"))+'</b> <span dir="auto">'+esc(localizedDimText(d, "green"))+'</span></p>' +
      '<p><b>'+esc(t("tribe.legend.redLabel"))+'</b> <span dir="auto">'+esc(localizedDimText(d, "red"))+'</span></p>' +
    '</div>';
  }).join("");
  document.getElementById("legendGrid").innerHTML = html || '<p class="hint" style="margin:0;">'+esc(t("tribe.legend.empty"))+'</p>';
  document.getElementById("legendAttrib").textContent = localizedAttribution(state.config.attribution) ||
    t("tribe.legend.attribDefault");
}

// ---------- grid interactions ----------
// (Squad renaming/removal now lives in Admin; rating entry now lives in
// Squad view -- the only remaining interaction inside the read-only Tribe
// grid is the dimension header tooltip.)
//
// Real bug, reported from usage: an earlier version bound mouseenter/
// mouseleave/focus/blur directly on each .dim-th-label, re-binding fresh on
// every renderGrid() call (which replaces the whole <thead> via one
// innerHTML write). A per-node listener only lives as long as that exact
// DOM node does -- if this collaborative board re-renders (a teammate's
// live edit, a rating save, a language switch, ...) while a tooltip is
// open, the very listener that would hide it can vanish along with the
// node it was bound to, leaving the tooltip orphaned with no live listener
// able to close it. Delegating to the STABLE `.table-scroll` wrapper (never
// itself replaced -- only #gridTable's innerHTML is) removes that whole
// failure class: there is exactly one set of listeners, bound once here at
// load, that no render can ever destroy. `renderGrid()` additionally calls
// hideDimTooltip() unconditionally before every rebuild as defense in
// depth (a no-op when nothing was open).
var gridScrollEl = document.querySelector(".table-scroll");
if(gridScrollEl){
  gridScrollEl.addEventListener("mouseover", function(e){
    var label = e.target.closest && e.target.closest(".dim-th-label");
    if(label) showDimTooltip(label);
  });
  gridScrollEl.addEventListener("mouseout", function(e){
    var leavingLabel = e.target.closest && e.target.closest(".dim-th-label");
    if(!leavingLabel) return;
    // relatedTarget is where the pointer is headed -- still somewhere
    // inside the same label (e.g. its own text) isn't really a leave
    if(e.relatedTarget && leavingLabel.contains(e.relatedTarget)) return;
    hideDimTooltip();
  });
  // focus/blur don't bubble -- focusin/focusout are their bubbling
  // counterparts, so the same one-time delegated binding covers keyboard
  // navigation too
  gridScrollEl.addEventListener("focusin", function(e){
    var label = e.target.closest && e.target.closest(".dim-th-label");
    if(label) showDimTooltip(label);
  });
  gridScrollEl.addEventListener("focusout", function(e){
    var label = e.target.closest && e.target.closest(".dim-th-label");
    if(label) hideDimTooltip();
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
    '<div class="tip-title" dir="auto">'+esc(localizedDimText(d, "label"))+'</div>' +
    '<div class="tip-row"><span class="tip-dot good"></span><span dir="auto">'+esc(localizedDimText(d, "green") || t("tribe.tooltip.noDescription"))+'</span></div>' +
    '<div class="tip-row"><span class="tip-dot crit"></span><span dir="auto">'+esc(localizedDimText(d, "red") || t("tribe.tooltip.noDescription"))+'</span></div>';
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
