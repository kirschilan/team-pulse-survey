"use strict";


// ---------- retro sessions (live, facilitated) -- PARTICIPANT side ----------
// Everything here runs on a teammate's own device, joining someone else's
// session -- the join screen, the blind interleaved statement survey, the
// direct-rating swatches, submission, and the personal-result view
// afterward. The facilitator's own device (starting/closing a session, the
// session card, overrides, the live tally) never runs any of this; see
// retro-facilitator.js for that half.
//
// Reached either by opening ?session=<id> directly, or -- the reliable
// path, since some phones' camera-to-app handoff doesn't carry a query
// string through -- by typing the session code into the "Join a retro"
// button in the header. Either way, once in join mode the device never
// sees the Tribe/Squad/Admin switcher -- only this one screen, which just
// watches that one session doc and reflects its current state.
function enterJoinMode(){
  var switcher = document.querySelector(".view-switch");
  if(switcher) switcher.hidden = true;
  var joinBtn = document.getElementById("joinCodeBtn");
  if(joinBtn) joinBtn.hidden = true;
  document.getElementById("viewTribe").hidden = true;
  document.getElementById("viewSquad").hidden = true;
  document.getElementById("viewAdmin").hidden = true;
  document.getElementById("viewJoin").hidden = false;
  renderJoinScreen();
}

// Entering a code at runtime (rather than loading with ?session= already in
// the URL) needs to kick off the same session listener manually, since the
// boot-time initDb() only auto-attaches it once, before any code exists.
function joinSessionByCode(code){
  state.joinSessionId = code;
  state.joinSession = null;
  enterJoinMode();
  if(state.live && state.db) listenJoinSession();
}

// Story 9: a participant can leave the join screen for the normal
// Tribe/Squad/Admin board, then come straight back to exactly where they
// left off. This ONLY toggles which section is visible -- it deliberately
// doesn't touch `state.joinSessionId` or unsubscribe listenJoinSession(),
// so the session keeps updating in the background and any in-progress
// draft answer or already-submitted personal result is still there,
// unchanged, on return. `joinCodeBtn` stays hidden the whole time (exited
// or not) so a participant can't accidentally start joining a SECOND
// session while this one's still open -- the join flow only ever tracks
// one at a time (see state.joinSessionId).
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

document.getElementById("joinCodeBtn").addEventListener("click", function(){
  document.getElementById("joinCodeInput").value = "";
  document.getElementById("joinCodeBackdrop").hidden = false;
  document.getElementById("joinCodeInput").focus({preventScroll:true});
});
function closeJoinCodeModal(){ document.getElementById("joinCodeBackdrop").hidden = true; }
document.getElementById("joinCodeCancel").addEventListener("click", closeJoinCodeModal);
document.getElementById("joinCodeBackdrop").addEventListener("click", function(e){
  if(e.target===document.getElementById("joinCodeBackdrop")) closeJoinCodeModal();
});
function submitJoinCode(){
  var raw = document.getElementById("joinCodeInput").value.trim().toUpperCase().replace(/\s+/g,"");
  if(!raw) return;
  closeJoinCodeModal();
  joinSessionByCode(raw);
}
document.getElementById("joinCodeGo").addEventListener("click", submitJoinCode);

// Story 10: same modal, same code, different verb -- "Co-facilitate"
// attaches this device to the session (coFacilitateSessionByCode(), in
// retro-facilitator.js) instead of entering the participant join screen.
function submitCoFacilitateCode(){
  var raw = document.getElementById("joinCodeInput").value.trim().toUpperCase().replace(/\s+/g,"");
  if(!raw) return;
  closeJoinCodeModal();
  coFacilitateSessionByCode(raw).catch(function(err){
    openConfirm(
      "Couldn’t co-facilitate that session",
      (err && err.message) ? err.message : "Something went wrong reaching the relay. Check the diagnostic log below for details.",
      function(){}, "OK"
    );
  });
}
document.getElementById("coFacilitateGo").addEventListener("click", submitCoFacilitateCode);
document.getElementById("joinCodeInput").addEventListener("keydown", function(e){
  if(e.key==="Enter") submitJoinCode();
});

// Personal result shown to a participant right after they submit one
// dimension: their score, its band, the pyramid's characterization line
// for anything not fully green, and the matching takeaway strategies. A
// direct-rating (Spotify-style) dimension has a band but no numeric sum --
// the score badge is simply omitted for those.
function renderPersonalResultHtml(dim, result){
  var band = result.band;
  var bandWord = band==="good" ? "Green" : band==="warn" ? "Yellow" : "Red";
  var msg = band==="good" ? dim.green : dim.red;
  var strategies = dim.strategies || [];
  var showStrategies = band!=="good" && strategies.length;
  var scoreHtml = (result.sum!==undefined && result.sum!==null)
    ? '<span class="result-score '+band+'">'+result.sum+'</span>' : "";
  return '<div class="personal-result">' +
    '<div class="field-label" style="margin-top:0;">'+esc(dim.label)+'</div>' +
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
      if(dim.statements && dim.statements[i]!==undefined) out.push({ dim: dim, idx: i, text: dim.statements[i] });
    });
  }
  return out;
}

function renderJoinScreen(){
  var el = document.getElementById("joinCard");
  if(!el) return;
  if(!state.live){
    el.innerHTML = '<h2>Connecting&hellip;</h2><p class="hint">Hang tight while we connect to the board.</p>';
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
      '<h2>This retro has ended</h2>' +
      '<p class="hint">The facilitator closed this session. Ask them for a new link if another one is starting.</p>';
    return;
  }
  if(!sess || sess.status !== "open"){
    if(state.joinUnavailable){
      el.innerHTML =
        '<h2>Can&rsquo;t connect to the retro server</h2>' +
        '<p class="hint">This device never reached the relay. Check your connection, or ask whoever&rsquo;s running the retro if it&rsquo;s up.</p>';
    } else {
      el.innerHTML =
        '<h2>This retro session isn&rsquo;t open</h2>' +
        '<p class="hint">Check the link with whoever is running the retro &mdash; it may have already ended, or the link may be out of date.</p>';
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
      '<h2 dir="auto">Thanks &mdash; here&rsquo;s your results</h2>' +
      '<p class="hint">Retro: &ldquo;'+esc(sess.templateName||"Custom")+'&rdquo;.</p>' +
      dims.map(function(d){ return renderPersonalResultHtml(d, state.joinSubmittedResults[d.key]); }).join("");
    return;
  }

  if(dims.length){
    var flatStatements = interleavedStatements(stmtDims);
    var statementListHtml = stmtDims.length ?
      '<div class="stmt-list">' + flatStatements.map(function(item){
        return '<div class="stmt-row" data-dim="'+esc(item.dim.key)+'" data-idx="'+item.idx+'"><div class="stmt-text" dir="auto">'+esc(item.text)+'</div>' +
          '<div class="scale-btns">' +
            '<button type="button" class="scale-btn" data-value="1">Rarely</button>' +
            '<button type="button" class="scale-btn" data-value="2">Sometimes</button>' +
            '<button type="button" class="scale-btn" data-value="3">Usually</button>' +
          '</div></div>';
      }).join("") + '</div>' : "";
    var directIntroHtml = (stmtDims.length && directDims.length) ?
      '<div class="field-label" style="margin-top:18px;">Squad health check</div>' : "";
    var directListHtml = directDims.length ?
      directIntroHtml + '<div class="direct-list">' + directDims.map(function(dim){
        var anchorsHtml = (dim.green || dim.red) ?
          '<p class="hint" style="margin:0 0 10px;" dir="auto">' +
            (dim.green ? '<b>Green:</b> '+esc(dim.green)+' ' : '') +
            (dim.red ? '<b>Red:</b> '+esc(dim.red) : '') +
          '</p>' : "";
        return '<div class="direct-row" data-dim="'+esc(dim.key)+'">' +
          '<div class="stmt-text" dir="auto">'+esc(dim.label)+'</div>' +
          anchorsHtml +
          '<div class="swatches">' +
            '<button class="swatch good" data-color="good" type="button" title="Green"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 13l4 4 10-10"/></svg></button>' +
            '<button class="swatch warn" data-color="warn" type="button" title="Yellow"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M6 12h12"/></svg></button>' +
            '<button class="swatch crit" data-color="crit" type="button" title="Red"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
          '</div>' +
        '</div>';
      }).join("") + '</div>' : "";
    el.innerHTML =
      '<h2 dir="auto">You&rsquo;re joining '+esc(sess.squadName||"the squad")+'&rsquo;s retro</h2>' +
      '<p class="hint">Retro: &ldquo;'+esc(sess.templateName||"Custom")+'&rdquo;. Answer honestly &mdash; your answers are anonymous, and only your squad&rsquo;s combined result is ever shown.</p>' +
      '<div id="stmtForm">' + statementListHtml + directListHtml + '</div>' +
      '<button class="btn primary" id="stmtSubmitBtn" type="button" disabled>Submit</button>';
    bindStatementForm(stmtDims, directDims);
    return;
  }

  // template has no dimensions at all -- nothing for anyone to rate
  el.innerHTML =
    '<h2 dir="auto">You&rsquo;re joining '+esc(sess.squadName||"the squad")+'&rsquo;s retro</h2>' +
    '<p class="hint">This retro doesn&rsquo;t have any dimensions set up yet.</p>';
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
  var submitBtn = document.getElementById("stmtSubmitBtn");
  if(!submitBtn) return;

  var drafts = {};
  stmtDims.forEach(function(dim){
    // NOTE: must fill with an explicit sentinel, not leave a sparse array --
    // Array.prototype.every() skips holes in a sparse array (vacuously
    // true), which would let an unanswered draft read as "complete" and
    // enable Submit before every statement has a real answer.
    drafts[dim.key] = state.joinDraftAnswers[dim.key] ||
      (state.joinDraftAnswers[dim.key] = new Array(dim.statements.length).fill(null));
  });
  // A direct-rating dimension's draft is just the picked color (or null
  // until picked), not an array -- same joinDraftAnswers map, keyed by
  // dimension key same as the statement dimensions above, since a session
  // never has two dimensions sharing a key.
  directDims.forEach(function(dim){
    if(!state.joinDraftAnswers.hasOwnProperty(dim.key)) state.joinDraftAnswers[dim.key] = null;
  });

  function refreshSubmitEnabled(){
    var stmtsComplete = stmtDims.every(function(dim){
      var draft = drafts[dim.key];
      return draft.length===dim.statements.length &&
        draft.every(function(v){ return v===1 || v===2 || v===3; });
    });
    var directComplete = directDims.every(function(dim){
      var v = state.joinDraftAnswers[dim.key];
      return v==="good" || v==="warn" || v==="crit";
    });
    submitBtn.disabled = !(stmtsComplete && directComplete);
  }

  // Statement rows are interleaved across dimensions in one flat list (see
  // interleavedStatements) rather than grouped under a per-dimension
  // wrapper, so each row carries its own dim/idx and is bound individually.
  document.querySelectorAll('#stmtForm .stmt-list .stmt-row').forEach(function(row){
    var dimKey = row.getAttribute("data-dim");
    var idx = Number(row.getAttribute("data-idx"));
    var draft = drafts[dimKey];
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

  submitBtn.addEventListener("click", function(){
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    var results = {};
    var payload = { answers:{}, submittedAt: nowIso() };
    stmtDims.forEach(function(dim){
      var draft = drafts[dim.key];
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
    liveOr(function(){
      return state.db.collection("sessions").doc(state.joinSessionId).collection("responses").add(payload)
        .then(afterSubmit)
        .catch(function(err){
          diag("Submit answer failed: " + (err && err.code ? err.code : String(err)));
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit";
        });
    }, afterSubmit);
  });
}

function listenJoinSession(){
  state.db.doc("sessions/" + state.joinSessionId).onSnapshot(function(snap){
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
}
