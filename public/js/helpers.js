"use strict";


var DIAG_LINES = [];
function diag(msg){
  var t = new Date().toISOString().slice(11,19);
  DIAG_LINES.push("[" + t + "] " + msg);
  if (DIAG_LINES.length > 40) DIAG_LINES.shift();
  var text = DIAG_LINES.join("\n");
  // Two places show this log: the Admin view's panel, and a participant's
  // own Join screen (which has no nav back to Admin at all -- someone
  // stuck on "this session isn't open" on their phone has no other way to
  // see what actually happened). Both share class="diag-log" so one call
  // updates whichever is currently in the DOM (only one is ever visible at
  // a time, but updating both costs nothing).
  var els = document.querySelectorAll(".diag-log");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    // Replacing textContent wholesale (the obvious way to do this) also
    // wipes out any text selection inside it -- meaning a fast-moving log
    // (e.g. the relay reconnecting every few seconds) makes the panel
    // impossible to select-and-copy, since each new line deselects
    // whatever was highlighted a moment before. Skip the DOM update for
    // this element while the user has an active selection inside it; the
    // next call after they let go catches it back up to date.
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode)) continue;
    el.textContent = text;
  }
}

// A synchronous throw or a rejected promise with nothing to .catch() it
// (e.g. an unexpected exception inside a click handler, before any
// explicit diag() call) previously vanished with zero trace in this log --
// exactly the situation a real bug report hit: "the button is disabled and
// the page does not respond," with nothing in Diagnostics to say why.
// Surfacing every uncaught error/rejection here, unconditionally, means
// the log always shows SOMETHING rather than silently stopping, even for
// failures nobody anticipated well enough to wrap in a try/catch.
window.addEventListener("error", function(evt){
  var msg = (evt && evt.message) || String(evt);
  var where = (evt && evt.filename) ? " (" + evt.filename + ":" + evt.lineno + ")" : "";
  diag("Uncaught error: " + msg + where);
});
window.addEventListener("unhandledrejection", function(evt){
  var reason = evt && evt.reason;
  var msg = (reason && reason.message) || (reason && reason.code) || String(reason);
  diag("Unhandled promise rejection: " + msg);
});

function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function nowIso(){ return new Date().toISOString(); }
function isJoinMode(){ return !!state.joinSessionId; }
function joinUrlFor(sessionId){
  return window.location.origin + window.location.pathname + "?session=" + encodeURIComponent(sessionId);
}
function slugify(s, fallback){
  var slug = String(s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  return slug || fallback;
}

function weight(color){ return color==="crit" ? 2 : color==="warn" ? 1 : 0; }

// Maps a scored-statement sum onto the existing good/warn/crit model, using
// a dimension's own scoreBands (falling back to the 5DF assessment's
// published 8/6 thresholds if a dimension somehow lacks them).
function bandForScore(sum, bands){
  bands = bands || { good:8, warn:6 };
  if(sum >= bands.good) return "good";
  if(sum >= bands.warn) return "warn";
  return "crit";
}

// Majority-of-bands, defaulting to the CALMER (less severe) bucket on a
// tie -- "benefit of the doubt when the team doesn't agree; the SM can
// still override toward the more severe read by hand" (locked decision,
// see the spec doc). good is calmest, crit is most severe.
function consolidateBand(bands){
  if(!bands || !bands.length) return null;
  var order = ["good","warn","crit"];
  var counts = { good:0, warn:0, crit:0 };
  bands.forEach(function(b){ if(counts.hasOwnProperty(b)) counts[b] += 1; });
  var max = Math.max(counts.good, counts.warn, counts.crit);
  for(var i=0;i<order.length;i++){ if(counts[order[i]]===max) return order[i]; }
  return null;
}

// One response's band for a single dimension (null if that response didn't
// cover this dimension -- shouldn't happen post-Story-5's atomic submit,
// but an older/partial response snapshot could still lack a key).
//
// A dimension with `statements` is scored by summing the 1/2/3 answers and
// mapping the sum through its scoreBands (Five Dysfunctions/Tuckman style).
// A dimension WITHOUT statements (Spotify Squad Health Check style) is
// answered with a single direct color pick instead -- the response's
// answer for that dimension IS the band already, nothing to sum or score.
function bandForResponse(dim, response){
  var ans = response && response.answers && response.answers[dim.key];
  if(ans===undefined || ans===null) return null;
  if(dim.statements && dim.statements.length){
    if(!ans.length) return null;
    var sum = ans.reduce(function(a,b){ return a+b; }, 0);
    return bandForScore(sum, dim.scoreBands);
  }
  return (ans==="good" || ans==="warn" || ans==="crit") ? ans : null;
}
// The "official" result for one dimension of a session right now: the SM's
// manual override if one is set (Story 7), otherwise the live
// majority/calmer-tie consolidation of submitted responses (Stories 4-6).
// Returns null when there's nothing to show yet -- no override and no
// responses -- so callers can distinguish "not scored yet" from a real band.
function effectiveDimResult(dim, sess, responses){
  var override = sess && sess.overrides && sess.overrides[dim.key];
  if(override && override.color){
    return { color: override.color, trend: override.trend || "flat", overridden: true };
  }
  var bands = (responses||[]).map(function(r){ return bandForResponse(dim, r); }).filter(function(b){ return !!b; });
  if(!bands.length) return null;
  return { color: consolidateBand(bands), trend: "flat", overridden: false };
}

function sortedDimensions(){
  return state.dimensions.slice().sort(function(a,b){ return (a.order||0)-(b.order||0); });
}
// Every dimension a retro session covers, in order. Story 4 scoped the
// join-page survey down to just one dimension (DF1) to prove the pipeline
// end-to-end cheaply; Story 5 opened it up to every STATEMENT-based
// dimension a template has. That left a gap: a dimension without
// `statements` (Spotify Squad Health Check style -- a direct green/yellow/
// red pick, no Likert questions behind it) was never made answerable by
// teammates at all -- the join screen just listed it read-only forever, so
// a squad running that template couldn't actually run a participatory
// retro; only the facilitator could rate it, by hand, on the squad view.
// Fixed here: EVERY dimension in a retro is answerable now, just via one
// of two mechanisms depending on its shape.
function retroDimensions(dims){
  return (dims||[]).slice().sort(function(a,b){ return (a.order||0)-(b.order||0); });
}
// The subset that uses the blind, interleaved Likert-statement survey.
function statementDimensions(dims){
  return retroDimensions(dims).filter(function(d){ return d.statements && d.statements.length; });
}
// The subset that's answered with one direct color pick instead (Spotify
// Squad Health Check style) -- shown openly labeled, same as Spotify's own
// exercise, not hidden/interleaved like the statement dimensions above.
function directRatingDimensions(dims){
  return retroDimensions(dims).filter(function(d){ return !(d.statements && d.statements.length); });
}
function dimByKey(key){
  for(var i=0;i<state.dimensions.length;i++){ if(state.dimensions[i].key===key) return state.dimensions[i]; }
  return null;
}

function squadScore(squad){
  var dims = sortedDimensions();
  var score=0, scored=0, counts={good:0,warn:0,crit:0,unscored:0};
  dims.forEach(function(d){
    var cell = squad.dimensions && squad.dimensions[d.key];
    var color = cell && cell.color ? cell.color : "unscored";
    counts[color]++;
    if(color!=="unscored"){ scored++; score += weight(color); }
  });
  return { score:score, scored:scored, counts:counts, total: dims.length };
}

function trendIcon(trend){
  if(trend==="up") return '<svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 15l7-7 7 7"/></svg>';
  if(trend==="down") return '<svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 9l7 7 7-7"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 12h14"/></svg>';
}
function markIcon(color){
  if(color==="good") return '<svg class="mark" viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 13l4 4 10-10"/></svg>';
  if(color==="warn") return '<svg class="mark" viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M6 12h12"/></svg>';
  if(color==="crit") return '<svg class="mark" viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  return '<svg class="mark" viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>';
}

function sortedSquads(){
  return state.squads.slice().sort(function(a,b){ return (a.order||0)-(b.order||0); });
}

function unitLower(){ return (state.config.unit||"Squad").toLowerCase(); }
function unitPluralLower(){ return (state.config.unitPlural||"Squads").toLowerCase(); }

function findSquad(id){
  for(var i=0;i<state.squads.length;i++){ if(state.squads[i].id===id) return state.squads[i]; }
  return null;
}

// Lets tests/unit/*.js `require()` this file's pure functions directly with
// plain Node -- no browser, no Playwright -- instead of only reaching them
// indirectly through a full page load and UI clicks. `module` doesn't exist
// in a browser, so this is a complete no-op there; nothing about how the
// real app loads or runs this file changes. See tests/unit/README.md.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    esc: esc, slugify: slugify, weight: weight,
    bandForScore: bandForScore, consolidateBand: consolidateBand,
    bandForResponse: bandForResponse, effectiveDimResult: effectiveDimResult,
    sortedDimensions: sortedDimensions, sortedSquads: sortedSquads,
    squadScore: squadScore, dimByKey: dimByKey, findSquad: findSquad,
    retroDimensions: retroDimensions, statementDimensions: statementDimensions,
    directRatingDimensions: directRatingDimensions
  };
}
