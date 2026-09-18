"use strict";


// ---------- retro sessions (live, facilitated) -- PARTICIPANT side ----------
// Everything here runs on a teammate's own device, joining someone else's
// session -- the join screen, the blind interleaved statement survey, the
// direct-rating swatches, submission, and the personal-result view
// afterward. The facilitator's own device (starting/closing a session, the
// session card, overrides, the live tally) never runs any of this; see
// retro-facilitator.js for that half.
//
// SEC-2 (STATUS.md's locked PO decision): reached only by opening
// ?session=<secret> -- scanning its QR code or opening its link -- never by
// typing a code in by hand; the join-code modal that used to offer that is
// gone. Once in join mode the device never sees the Tribe/Squad/Admin
// switcher -- only this one screen, which just watches that one session doc
// and reflects its current state.
function enterJoinMode(){
  var switcher = document.querySelector(".view-switch");
  if(switcher) switcher.hidden = true;
  document.getElementById("viewTribe").hidden = true;
  document.getElementById("viewSquad").hidden = true;
  document.getElementById("viewAdmin").hidden = true;
  document.getElementById("viewJoin").hidden = false;
  renderJoinScreen();
}

// Entering a session at runtime (rather than loading with ?session=<secret>
// already in the URL) needs to kick off the same session listener manually,
// since the boot-time initDb() only auto-attaches it once, before any
// secret exists. Kept as its own function (rather than inlined into the
// boot-time path) since it's also the most direct way for a test to enter
// join mode for a known secret without going through the UI.
function joinSessionByCode(secret){
  state.joinSessionId = secret;
  state.joinSession = null;
  state.joinRoomId = null;
  enterJoinMode();
  if(state.live && state.db) listenJoinSession();
}

// Story 9: a participant can leave the join screen for the normal
// Tribe/Squad/Admin board, then come straight back to exactly where they
// left off. This ONLY toggles which section is visible -- it deliberately
// doesn't touch `state.joinSessionId` or unsubscribe listenJoinSession(),
// so the session keeps updating in the background and any in-progress
// draft answer or already-submitted personal result is still there,
// unchanged, on return. There's no way to start joining a SECOND session
// from within the app (no typed-code entry point any more -- see SEC-2) so
// the join flow only ever tracks one at a time (see state.joinSessionId).
function exitJoinScreen(){
  if(!state.joinSessionId) return;
  document.getElementById("viewJoin").hidden = true;
  var switcher = document.querySelector(".view-switch");
  if(switcher) switcher.hidden = false;
  document.getElementById("backToRetroBtn").hidden = false;
  applyViewVisibility();
  renderAll();
}
function returnToJoinScreen(){
  document.getElementById("viewTribe").hidden = true;
  document.getElementById("viewSquad").hidden = true;
  document.getElementById("viewAdmin").hidden = true;
  var switcher = document.querySelector(".view-switch");
  if(switcher) switcher.hidden = true;
  document.getElementById("backToRetroBtn").hidden = true;
  document.getElementById("viewJoin").hidden = false;
  renderJoinScreen();
}
document.getElementById("exitJoinBtn").addEventListener("click", exitJoinScreen);
document.getElementById("backToRetroBtn").addEventListener("click", returnToJoinScreen);

// Personal result shown to a participant right after they submit one
// dimension: their score, its band, the pyramid's characterization line
// for anything not fully green, and the matching takeaway strategies. A
// direct-rating (Spotify-style) dimension has a band but no numeric sum --
// the score badge is simply omitted for those. `dim` here is a retro
// session's own frozen snapshot copy (see startSession() in
// retro-facilitator.js), which carries its `i18n` field forward same as
// label/green/red/statements -- localizedDimText() (state.js) needs
// nothing else to translate it correctly.
function renderPersonalResultHtml(dim, result){
  var band = result.band;
  var bandWord = colorWordLocalized(band);
  var msg = band==="good" ? localizedDimText(dim, "green") : localizedDimText(dim, "red");
  var strategies = localizedDimText(dim, "strategies") || [];
  var showStrategies = band!=="good" && strategies.length;
  var scoreHtml = (result.sum!==undefined && result.sum!==null)
    ? '<span class="result-score '+band+'">'+result.sum+'</span>' : "";
  return '<div class="personal-result">' +
    '<div class="field-label" style="margin-top:0;">'+esc(localizedDimText(dim, "label"))+'</div>' +
    '<div class="result-hero">'+scoreHtml+'<span class="pill '+band+'">'+bandWord+'</span></div>' +
    (msg ? '<p class="hint" style="margin:0 0 '+(showStrategies?'10px':'0')+';" dir="auto">'+esc(msg)+'</p>' : "") +
    (showStrategies ?
      '<div class="anchor-pair">' + strategies.map(function(s){ return '<p dir="auto">'+esc(s)+'</p>'; }).join("") + '</div>'
      : "") +
  '</div>';
}

// Round-robin interleaves each dimension's statements (1st statement of
// every dimension, then the 2nd of every dimension, ...) instead of
// grouping and titling one dimension's questions at a time -- this is how
// the published Five Dysfunctions assessment presents its 15 statements
// too, precisely so a respondent can't tell which dysfunction a given
// question is scoring. Deterministic on purpose, not a random shuffle: the
// join screen re-renders on every session-doc change (see
// listenJoinSession), so a fresh random order on each render would
// reshuffle the questions out from under someone mid-survey.
function interleavedStatements(dims){
  var maxLen = dims.reduce(function(m,d){ return Math.max(m, (d.statements||[]).length); }, 0);
  var out = [];
  for(var i=0;i<maxLen;i+=1){
    dims.forEach(function(dim){
      if(dim.statements && dim.statements[i]!==undefined){
        var localized = localizedDimText(dim, "statements");
        out.push({ dim: dim, idx: i, text: (localized && localized[i]!==undefined) ? localized[i] : dim.statements[i] });
      }
    });
  }
  return out;
}

// One interleaved statement row's markup -- pulled out of renderJoinScreen()
// so RETRO-2's paced (one-question-at-a-time) rendering can build the exact
// same row for a SINGLE item that the all-at-once survey builds for every
// item, with nothing to keep in sync between the two.
function stmtRowHtml(item){
  return '<div class="stmt-row" data-dim="'+esc(item.dim.key)+'" data-idx="'+item.idx+'"><div class="stmt-text" dir="auto">'+esc(item.text)+'</div>' +
    '<div class="scale-btns">' +
      '<button type="button" class="scale-btn" data-value="1">'+esc(t("join.scale.rarely"))+'</button>' +
      '<button type="button" class="scale-btn" data-value="2">'+esc(t("join.scale.sometimes"))+'</button>' +
      '<button type="button" class="scale-btn" data-value="3">'+esc(t("join.scale.usually"))+'</button>' +
    '</div></div>';
}
// One direct-rating dimension's row markup -- see stmtRowHtml()'s own
// comment above for why this is pulled out the same way.
function directRowHtml(dim){
  var greenText = localizedDimText(dim, "green");
  var redText = localizedDimText(dim, "red");
  var anchorsHtml = (greenText || redText) ?
    '<p class="hint" style="margin:0 0 10px;">' +
      (greenText ? '<b>'+esc(t("tribe.legend.greenLabel"))+'</b> <span dir="auto">'+esc(greenText)+'</span> ' : '') +
      (redText ? '<b>'+esc(t("tribe.legend.redLabel"))+'</b> <span dir="auto">'+esc(redText)+'</span>' : '') +
    '</p>' : "";
  return '<div class="direct-row" data-dim="'+esc(dim.key)+'">' +
    '<div class="stmt-text" dir="auto">'+esc(localizedDimText(dim, "label"))+'</div>' +
    anchorsHtml +
    '<div class="swatches">' +
      '<button class="swatch good" data-color="good" type="button" title="'+esc(t("common.color.good"))+'"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 13l4 4 10-10"/></svg></button>' +
      '<button class="swatch warn" data-color="warn" type="button" title="'+esc(t("common.color.warn"))+'"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M6 12h12"/></svg></button>' +
      '<button class="swatch crit" data-color="crit" type="button" title="'+esc(t("common.color.crit"))+'"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
    '</div>' +
  '</div>';
}

// RETRO-2: true once every statement/direct-rating dimension in the draft
// has a real answer -- the same completeness check both the all-at-once
// Submit button (refreshSubmitEnabled(), bindStatementForm() below) and
// the paced flow's auto-submit-at-the-end (renderJoinScreen() below) need,
// pulled out so there's exactly one definition of "done answering."
function isJoinDraftComplete(stmtDims, directDims){
  var stmtsComplete = stmtDims.every(function(dim){
    var draft = state.joinDraftAnswers[dim.key];
    return !!draft && draft.length===dim.statements.length &&
      draft.every(function(v){ return v===1 || v===2 || v===3; });
  });
  var directComplete = directDims.every(function(dim){
    var v = state.joinDraftAnswers[dim.key];
    return v==="good" || v==="warn" || v==="crit";
  });
  return stmtsComplete && directComplete;
}

// The one atomic write covering every dimension of both kinds -- pulled out
// of bindStatementForm()'s Submit click handler so RETRO-2's paced flow can
// call the exact same completion path once the facilitator advances past
// the last question, instead of waiting on a Submit click that a paced
// screen doesn't even show (advancement there is facilitator-controlled,
// not participant-initiated -- see renderJoinScreen()'s pacing branch).
// Reads straight from state.joinDraftAnswers rather than a local copy, so
// it works whether or not this render pass actually built any rows.
function submitJoinAnswers(stmtDims, directDims){
  var results = {};
  var payload = { answers:{}, submittedAt: nowIso() };
  stmtDims.forEach(function(dim){
    var draft = state.joinDraftAnswers[dim.key];
    var sum = draft.reduce(function(a,b){ return a+b; }, 0);
    results[dim.key] = { sum: sum, band: bandForScore(sum, dim.scoreBands) };
    payload.answers[dim.key] = draft.slice();
  });
  directDims.forEach(function(dim){
    var val = state.joinDraftAnswers[dim.key];
    results[dim.key] = { band: val };
    payload.answers[dim.key] = val;
  });
  var afterSubmit = function(){
    Object.keys(results).forEach(function(k){ state.joinSubmittedResults[k] = results[k]; });
    renderJoinScreen();
  };
  return liveOr(function(){
    return state.db.doc("sessions/" + state.joinRoomId, state.joinSessionId).collection("responses").add(payload)
      .then(afterSubmit)
      .catch(function(err){
        diag("Submit answer failed: " + (err && err.code ? err.code : String(err)));
        throw err;
      });
  }, function(){ afterSubmit(); return Promise.resolve(); });
}

// RETRO-2's paced flow auto-submits once the facilitator finishes
// questioning -- unlike the manual Submit button (bindStatementForm()
// below), there's no click for a participant to retry from, so a real
// write failure (a relay hiccup, not a bug) needs its own visible
// failure-and-retry path. Codex review on PR #30 (P2): the first version
// of this only reset `joinAutoSubmitting` on rejection and never
// re-rendered, so the screen stayed on "Submitting..." forever with no
// error and no way to retry short of reloading the page and losing the
// draft. Fixed by setting `joinAutoSubmitFailed` and re-rendering into an
// explicit failure state (renderJoinScreen() below) with a retry button
// that calls this same function again -- the draft itself
// (state.joinDraftAnswers) is never touched by a failed attempt, so retry
// resubmits the exact same answers, not a reset survey.
function attemptPacedAutoSubmit(stmtDims, directDims){
  state.joinAutoSubmitFailed = false;
  state.joinAutoSubmitting = true;
  submitJoinAnswers(stmtDims, directDims).catch(function(err){
    diag("Paced auto-submit failed: " + (err && err.code ? err.code : String(err)));
    state.joinAutoSubmitting = false;
    state.joinAutoSubmitFailed = true;
    renderJoinScreen();
  });
}

function renderJoinScreen(){
  var el = document.getElementById("joinCard");
  if(!el) return;
  if(!state.live){
    el.innerHTML = '<h2>'+esc(t("join.connectingHeading"))+'</h2><p class="hint">'+esc(t("join.connectingHint"))+'</p>';
    return;
  }
  var sess = state.joinSession;
  // Three distinct outcomes, told apart as honestly as a database-free
  // relay allows (see STATUS.md's locked decisions): a session that was
  // explicitly closed (the doc still exists, briefly, with status:"closed"
  // -- see closeSession() in retro-facilitator.js) is a different situation
  // from this device never reaching the relay at all, which is different
  // again from the relay being reachable but genuinely having no such
  // room. That last case is the one honest limit: a bad code and a code
  // that expired so long ago the relay has completely forgotten it are
  // indistinguishable, since nothing here persists beyond the room's own
  // lifetime.
  if(sess && sess.status === "closed"){
    el.innerHTML =
      '<h2>'+esc(t("join.endedHeading"))+'</h2>' +
      '<p class="hint">'+esc(t("join.endedHint"))+'</p>';
    return;
  }
  if(!sess || sess.status !== "open"){
    if(state.joinUnavailable){
      el.innerHTML =
        '<h2>'+esc(t("join.unavailableHeading"))+'</h2>' +
        '<p class="hint">'+esc(t("join.unavailableHint"))+'</p>';
    } else {
      el.innerHTML =
        '<h2>'+esc(t("join.notOpenHeading"))+'</h2>' +
        '<p class="hint">'+esc(t("join.notOpenHint"))+'</p>';
    }
    return;
  }
  // Every dimension in the retro is answerable by teammates now: dimensions
  // with `statements` (Five Dysfunctions/Tuckman style) go through the
  // blind, interleaved Likert survey below; dimensions without them
  // (Spotify Squad Health Check style) get one direct, openly-labeled
  // green/yellow/red pick instead -- the same swatches the facilitator
  // already uses on the squad view, just answered by each teammate on
  // their own device and consolidated the same way as everything else.
  var dims = retroDimensions(sess.dimensions);
  var stmtDims = statementDimensions(sess.dimensions);
  var directDims = directRatingDimensions(sess.dimensions);
  var alreadySubmitted = dims.length>0 &&
    dims.every(function(d){ return !!state.joinSubmittedResults[d.key]; });

  if(alreadySubmitted){
    el.innerHTML =
      '<h2>'+esc(t("join.thanksHeading"))+'</h2>' +
      '<p class="hint">'+esc(t("join.retroLabel", {name: sess.templateName||"Custom"}))+'</p>' +
      dims.map(function(d){ return renderPersonalResultHtml(d, state.joinSubmittedResults[d.key]); }).join("");
    return;
  }

  if(dims.length){
    // RETRO-2: a paced session shows exactly one item from
    // pacingSequence(sess.dimensions) at a time (facilitator-controlled,
    // via sess.currentQuestionIndex), instead of the whole survey at once.
    // Ensure every dim's draft exists BEFORE either branch below reads/
    // checks it (same init bindStatementForm() always did, just no longer
    // gated behind that function actually rendering a row for every dim --
    // a paced render only builds ONE row per pass).
    stmtDims.forEach(function(dim){
      if(!state.joinDraftAnswers[dim.key]) state.joinDraftAnswers[dim.key] = new Array(dim.statements.length).fill(null);
    });
    directDims.forEach(function(dim){
      if(!Object.prototype.hasOwnProperty.call(state.joinDraftAnswers, dim.key)) state.joinDraftAnswers[dim.key] = null;
    });

    if(sess.pacingEnabled){
      var pacingSeq = pacingSequence(sess.dimensions);
      var qIdx = sess.currentQuestionIndex || 0;
      if(qIdx >= pacingSeq.length){
        // "Questioning finished" sentinel -- the facilitator has advanced
        // past the last question. Auto-submit once (guarded by
        // joinAutoSubmitting so a second onSnapshot delivery before the
        // write settles doesn't fire a duplicate response) if every
        // dimension is actually answered; otherwise this participant fell
        // behind, and gets a friendly wait state rather than a bad partial
        // submit or a silent no-op.
        if(isJoinDraftComplete(stmtDims, directDims)){
          if(state.joinAutoSubmitFailed){
            // Codex review on PR #30 (P2): a real write failure here used
            // to leave the screen stuck on "Submitting..." forever -- see
            // attemptPacedAutoSubmit()'s own header comment. The retry
            // button below calls the exact same function; the draft is
            // untouched by a failed attempt, so retrying resubmits the
            // same answers, not a reset survey.
            el.innerHTML =
              '<h2>'+esc(t("join.pacing.submitFailedHeading"))+'</h2>' +
              '<p class="hint pacing-submit-failed">'+esc(t("join.pacing.submitFailedHint"))+'</p>' +
              '<button class="btn primary" id="pacingRetrySubmitBtn" type="button">'+esc(t("join.pacing.retryButton"))+'</button>';
            var retryBtn = document.getElementById("pacingRetrySubmitBtn");
            if(retryBtn) retryBtn.addEventListener("click", function(){
              attemptPacedAutoSubmit(stmtDims, directDims);
              renderJoinScreen();
            });
            return;
          }
          if(!state.joinAutoSubmitting) attemptPacedAutoSubmit(stmtDims, directDims);
          el.innerHTML =
            '<h2>'+esc(t("join.joiningHeading", {squad: sess.squadName||"the squad"}))+'</h2>' +
            '<p class="hint">'+esc(t("join.submittingButton"))+'</p>';
        } else {
          el.innerHTML =
            '<h2>'+esc(t("join.pacing.waitingHeading"))+'</h2>' +
            '<p class="hint pacing-waiting">'+esc(t("join.pacing.waitingHint"))+'</p>';
        }
        return;
      }
      var item = pacingSeq[qIdx];
      var rowHtml;
      if(item.kind==="stmt"){
        var stmtDim = stmtDims.filter(function(d){ return d.key===item.dimKey; })[0];
        var localizedStmts = localizedDimText(stmtDim, "statements");
        var text = (localizedStmts && localizedStmts[item.idx]!==undefined) ? localizedStmts[item.idx] : stmtDim.statements[item.idx];
        rowHtml = '<div class="stmt-list">' + stmtRowHtml({ dim: stmtDim, idx: item.idx, text: text }) + '</div>';
      } else {
        var directDim = directDims.filter(function(d){ return d.key===item.dimKey; })[0];
        rowHtml = '<div class="direct-list">' + directRowHtml(directDim) + '</div>';
      }
      el.innerHTML =
        '<h2>'+esc(t("join.joiningHeading", {squad: sess.squadName||"the squad"}))+'</h2>' +
        '<p class="hint" id="pacingCounter">'+esc(t("join.pacing.counter", {current: qIdx+1, total: pacingSeq.length}))+'</p>' +
        '<p class="hint">'+esc(t("join.pacing.hint"))+'</p>' +
        '<div id="stmtForm">' + rowHtml + '</div>';
      bindStatementForm(stmtDims, directDims);
      return;
    }

    var flatStatements = interleavedStatements(stmtDims);
    var statementListHtml = stmtDims.length ?
      '<div class="stmt-list">' + flatStatements.map(stmtRowHtml).join("") + '</div>' : "";
    var directIntroHtml = (stmtDims.length && directDims.length) ?
      '<div class="field-label" style="margin-top:18px;">'+esc(t("join.squadHealthCheckHeading"))+'</div>' : "";
    var directListHtml = directDims.length ?
      directIntroHtml + '<div class="direct-list">' + directDims.map(directRowHtml).join("") + '</div>' : "";
    el.innerHTML =
      '<h2>'+esc(t("join.joiningHeading", {squad: sess.squadName||"the squad"}))+'</h2>' +
      '<p class="hint">'+esc(t("join.retroLabel", {name: sess.templateName||"Custom"}))+' '+esc(t("join.formHint"))+'</p>' +
      '<div id="stmtForm">' + statementListHtml + directListHtml + '</div>' +
      '<button class="btn primary" id="stmtSubmitBtn" type="button" disabled>'+esc(t("join.submitButton"))+'</button>';
    bindStatementForm(stmtDims, directDims);
    return;
  }

  // template has no dimensions at all -- nothing for anyone to rate
  el.innerHTML =
    '<h2>'+esc(t("join.joiningHeading", {squad: sess.squadName||"the squad"}))+'</h2>' +
    '<p class="hint">'+esc(t("join.noDimensionsHint"))+'</p>';
}

// Wires up both flavors of retro answer at once: the 1/2/3 scale buttons
// across every statement-based dimension's statement list, and the direct
// green/yellow/red swatches for every dimension that has no statements
// (Spotify Squad Health Check style). Selections are kept directly on the
// buttons' classes (same pattern as the existing rating modal's swatches/
// trend selector) rather than a full re-render per click, so answering
// feels instant; only Submit re-renders. Submit is a single write covering
// every dimension of both kinds -- "storage granularity doesn't matter"
// (locked decision), so one atomic submission per person is the simplest
// shape.
function bindStatementForm(stmtDims, directDims){
  stmtDims = stmtDims || [];
  directDims = directDims || [];
  // RETRO-2: no early return when this is null -- a paced render (see
  // renderJoinScreen()) shows one question at a time with NO Submit
  // button at all (advancement is facilitator-controlled), but its one
  // rendered row still needs its click handler bound the same as any
  // other. Every draft was already initialized by renderJoinScreen()
  // before calling this, whether or not a row for every dim got rendered
  // this pass, so nothing here depends on `submitBtn` existing.
  var submitBtn = document.getElementById("stmtSubmitBtn");

  function refreshSubmitEnabled(){
    if(!submitBtn) return;
    submitBtn.disabled = !isJoinDraftComplete(stmtDims, directDims);
  }

  // Statement rows are interleaved across dimensions in one flat list (see
  // interleavedStatements) rather than grouped under a per-dimension
  // wrapper, so each row carries its own dim/idx and is bound individually.
  document.querySelectorAll('#stmtForm .stmt-list .stmt-row').forEach(function(row){
    var dimKey = row.getAttribute("data-dim");
    var idx = Number(row.getAttribute("data-idx"));
    var draft = state.joinDraftAnswers[dimKey];
    if(!draft) return;
    row.querySelectorAll(".scale-btn").forEach(function(btn){
      var val = Number(btn.getAttribute("data-value"));
      if(val === draft[idx]) btn.classList.add("selected");
      btn.addEventListener("click", function(){
        draft[idx] = val;
        row.querySelectorAll(".scale-btn").forEach(function(b){ b.classList.toggle("selected", b===btn); });
        refreshSubmitEnabled();
      });
    });
  });

  // Direct-rating rows -- each is openly labeled with the dimension name
  // (unlike the blind statement rows above), and answered with one swatch
  // pick, same three-way choice a facilitator makes by hand on the squad
  // view.
  document.querySelectorAll('#stmtForm .direct-list .direct-row').forEach(function(row){
    var dimKey = row.getAttribute("data-dim");
    row.querySelectorAll(".swatch").forEach(function(btn){
      var val = btn.getAttribute("data-color");
      if(val === state.joinDraftAnswers[dimKey]) btn.classList.add("selected");
      btn.addEventListener("click", function(){
        state.joinDraftAnswers[dimKey] = val;
        row.querySelectorAll(".swatch").forEach(function(b){ b.classList.toggle("selected", b===btn); });
        refreshSubmitEnabled();
      });
    });
  });

  refreshSubmitEnabled();

  if(submitBtn) submitBtn.addEventListener("click", function(){
    submitBtn.disabled = true;
    submitBtn.textContent = t("join.submittingButton");
    submitJoinAnswers(stmtDims, directDims).catch(function(){
      submitBtn.disabled = false;
      submitBtn.textContent = t("join.submitButton");
    });
  });
}

// SEC-2: state.joinSessionId holds the session's SECRET (from ?session=
// in the URL), not its relay room id any more -- resolve the room id
// first (the same async step board-sync.js's own hydrate/subscribe do),
// then subscribe with both, exactly like startSession()/
// coFacilitateSessionByCode() in retro-facilitator.js.
function listenJoinSession(){
  var secret = state.joinSessionId;
  SquadPulseCrypto.roomIdFor(secret).then(function(roomId){
    if(state.joinSessionId !== secret) return; // superseded before this resolved
    state.joinRoomId = roomId;
    state.db.doc("sessions/" + roomId, secret).onSnapshot(function(snap){
      state.joinSession = snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
      // `unavailable` (relay-client.js only -- local-store.js's other,
      // non-session snapshots never set it, so this is falsy/absent there)
      // means this device never reached the relay at all, as distinct from
      // reaching it and finding no such document -- see renderJoinScreen()
      // above.
      state.joinUnavailable = !!snap.unavailable;
      diag("Join session snapshot: " + (state.joinSession ? state.joinSession.status : (state.joinUnavailable ? "relay unavailable" : "not found")));
      renderJoinScreen();
    }, function(err){
      diag("Join session listener error: " + (err && err.code ? err.code : String(err)));
      state.joinSession = null;
      renderJoinScreen();
    });
  });
}
