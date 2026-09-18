"use strict";


// ---------- retro sessions (live, facilitated) -- FACILITATOR side ----------
// Everything here runs on a device with a FACILITATOR'S view of the
// session: the session card on Squad view, starting/closing it, the live
// reveal toggle and per-dimension override, the sprint-experiment note,
// finishing and applying results into the squad's own ratings, and the
// live tally of anonymous submissions. Originally only the device that
// started the session ever saw this; story 10's coFacilitateSessionByCode()
// below lets a SECOND device attach to an already-open session and get
// the exact same view -- nothing in this file distinguishes "started it"
// from "attached to it," since openSessionForSquad() below only checks
// state.sessions, never who created the entry. The PARTICIPANT'S device --
// the join screen a teammate answers on -- never runs any of this; see
// retro-join.js for that half. The two share almost no code
// (bandForResponse/effectiveDimResult/etc. in helpers.js are the closest
// thing to overlap), which is what makes this a clean split rather than an
// arbitrary one.
//
// A session is a lightweight live event scoped to one squad: the SM starts
// one (snapshotting the board's CURRENT dimensions, so later template
// changes don't retroactively alter a session already in progress), shares
// the join link/QR, and closes it when done. Closing marks it status:
// "closed" rather than deleting it outright (see closeSession() below) --
// there's no history feature beyond that brief window, matching the
// "current snapshot only" decision made for the rest of the board, so
// nothing is archived long-term.
function openSessionForSquad(squadId){
  for(var i=0;i<state.sessions.length;i++){
    var s = state.sessions[i];
    if(s.squadId===squadId && s.status==="open") return s;
  }
  return null;
}

// Story 10: attaches this device to an ALREADY-OPEN session by its
// co-facilitate link's secret, without starting or answering anything --
// just reading the session doc once is enough to make relay-client.js's
// getRoom() remember the room (see rememberCode()) and connect, so the
// broad `sessions` listener db.js's initDb() already runs for every
// non-join-mode device picks it up the moment the relay's initial snapshot
// for that room arrives. openSessionForSquad() above never checks who
// created a state.sessions entry, so once this device "knows" the room, Squad
// view for the matching squad renders the exact same facilitator card (live
// tally, reveal, override, finish) a device that started the session sees --
// no separate rendering path needed. Requires the squad to already exist
// locally (e.g. via a connected team link, see board-sync.js) for
// anything meaningful to show; without that, Squad view just has no
// matching squad to select, same as picking any squad this device
// doesn't have.
function coFacilitateSessionByCode(secret){
  if(!(state.live && state.db)) return Promise.reject({ message: t("retro.coFacilitate.notConnected") });
  return SquadPulseCrypto.roomIdFor(secret).then(function(roomId){
    // Recorded explicitly, not left to relay-client.js's own getRoom() side
    // effect (see relay-client.js's own comment on rememberCode) -- that
    // side effect never runs at all against a `state.db` that isn't
    // relay-client.js itself (e.g. the test suite's fake local store), and
    // renderSessionCardHtml()'s secretForRoom() lookup needs this regardless.
    SquadPulseRelay.rememberCode(roomId, secret);
    return state.db.doc("sessions/" + roomId, secret).get();
  }).then(function(snap){
    if(!snap.exists) return Promise.reject({ message: t("retro.coFacilitate.codeNotOpen") });
    var data = snap.data();
    if(data.squadId) selectSquad(data.squadId);
    setView("squad");
    return data;
  });
}

function startSession(sq, pacingEnabled, excludedDimKeys){
  // snapshot dimensions the same way saveCurrentAsTemplate()/loadTemplate()
  // do, carrying statements/scoreBands/strategies (and any Hebrew
  // translation the dimension has -- see state.js's localizedDimText())
  // along so the retro flow can render this session correctly translated
  // (Story 11 / the retro-statement-translation follow-up).
  //
  // RETRO-3: a facilitator can exclude specific dimensions from THIS retro
  // only (the "no session" card's checklist below) -- a one-off skip, never
  // a template edit. Filtering them out of the snapshot right here, before
  // it's ever written to the session doc, is what makes every downstream
  // consumer (the join survey in retro-join.js, pacingSequence(), the live
  // tally, finishRetroAndApply()) correctly skip an excluded dimension with
  // ZERO changes of their own -- none of them know or care that a
  // dimension was excluded, they just never see it, because it was never in
  // sess.dimensions to begin with. Deliberately whole-dimension only, not
  // per-statement: a statement dimension's scoreBands are calibrated
  // against summing ALL of its statements, so dropping only some of them
  // would silently shift what "good"/"warn"/"crit" mean.
  var excluded = {};
  (excludedDimKeys||[]).forEach(function(k){ excluded[k] = true; });
  var dimsSnapshot = sortedDimensions().filter(function(d){ return !excluded[d.key]; }).map(function(d){
    var spec = { key:d.key, label:d.label, green:d.green||"", red:d.red||"", order:d.order||0 };
    if(isStatementDimension(d)) spec.statements = d.statements;
    if(d.scoreBands) spec.scoreBands = d.scoreBands;
    if(d.strategies && d.strategies.length) spec.strategies = d.strategies;
    if(d.i18n) spec.i18n = d.i18n;
    return spec;
  });
  var payload = {
    squadId: sq.id, squadName: sq.name,
    templateName: state.config.activeTemplateName || "Custom",
    dimensions: dimsSnapshot,
    status: "open", revealMode: "hold",
    overrides: {}, experimentNote: "",
    createdAt: nowIso(),
    // RETRO-2: paced ("one question at a time") is a session-level choice
    // made once, at start -- default false, preserving today's all-at-once
    // survey unchanged for every existing session and every facilitator who
    // doesn't opt in. `currentQuestionIndex` is only ever meaningful when
    // `pacingEnabled` is true; it's still written (at 0) either way so
    // there's one consistent shape to read, not an optional field callers
    // have to guard against being absent.
    pacingEnabled: !!pacingEnabled, currentQuestionIndex: 0
  };
  // SEC-2: a live session's room id and its encryption key are no longer
  // the same value -- see crypto.js's header comment. generateSecret()/
  // roomIdFor() are the exact same primitives board-sync.js already uses
  // for the identical reason; a session's secret never touches the relay,
  // only its one-way-derived room id does.
  var secret = SquadPulseCrypto.generateSecret();
  return SquadPulseCrypto.roomIdFor(secret).then(function(roomId){
    // See coFacilitateSessionByCode()'s identical call for why this is
    // explicit rather than left to relay-client.js's own getRoom() side
    // effect.
    SquadPulseRelay.rememberCode(roomId, secret);
    return liveOr(function(){
      return state.db.doc("sessions/" + roomId, secret).set(payload).then(function(){
        diag("Started retro session " + roomId + " for squad " + sq.id);
      }).catch(function(err){
        diag("Start session failed: " + (err && err.code ? err.code : String(err)));
        throw err;
      });
    }, function(){
      state.sessions.push(Object.assign({ id:roomId }, payload));
      renderSquadView();
      return Promise.resolve();
    });
  });
}

function closeSession(sessionId){
  // An update to status:"closed" rather than a delete -- a participant
  // already on the join screen (or one who opens a stale link soon
  // after) then sees a real "this retro has ended" instead of the same
  // generic "isn't open" a bad code or an unreachable relay produces.
  // The doc still goes away eventually once the relay's own room-empty
  // grace period elapses (see relay/server.js) -- this only widens the
  // window in which "closed" is distinguishable, it doesn't make it
  // permanent, since nothing here is a real database.
  liveOr(function(){
    return state.db.collection("sessions").doc(sessionId).update({ status:"closed", closedAt: nowIso() }).catch(function(err){
      diag("Close session failed: " + (err && err.code ? err.code : String(err)));
    });
  }, function(){
    state.sessions = state.sessions.filter(function(s){ return s.id!==sessionId; });
    renderSquadView();
  });
}

// RETRO-2 follow-up (PO review): the facilitator's own session card only
// ever showed a bare "Question X of N" counter during a paced session --
// no way to know WHAT that question actually asks without also having a
// participant's device open next to it. Resolves the exact same text
// retro-join.js's own paced render shows a participant for pacingSeq[index]
// -- duplicated here rather than shared via helpers.js because it calls
// localizedDimText() (state.js), which -- like this function -- depends on
// live app state/locale and can't run through the Node-only unit-test
// harness a true helpers.js function does (see tests/unit/README.md);
// Playwright-tested only, same as retro-join.js's own version. Returns
// null past the end of the sequence (nothing to show).
function pacingQuestionText(dims, seq, index){
  var item = seq[index];
  if(!item) return null;
  var dim = dims.filter(function(d){ return d.key===item.dimKey; })[0];
  if(!dim) return null;
  if(item.kind==="stmt"){
    var localizedStmts = localizedDimText(dim, "statements");
    return (localizedStmts && localizedStmts[item.idx]!==undefined) ? localizedStmts[item.idx] : dim.statements[item.idx];
  }
  return localizedDimText(dim, "label");
}

// This card renders inside #viewSquad, which Story 4 made i18n-supported
// (flips to dir="rtl" under Hebrew) -- Story 11 brought this flow's own
// chrome under translation too, so it now inherits that flip like the rest
// of Squad view, rather than opting out with its own dir="ltr" the way it
// did before this story.
function renderSessionCardHtml(sq){
  var sess = openSessionForSquad(sq.id);
  if(!sess){
    // RETRO-3: one checkbox per board dimension, checked (included) by
    // default -- unchecking one excludes it from THIS session only (see
    // startSession()'s own comment). Checked state is restored from
    // pendingDimExclusionsFor (below), not hardcoded to `checked` --
    // Codex review on PR #34 found that state.dimensions changing AT ALL
    // (even on an unrelated dimension, from this device or a
    // co-facilitator's) fires db.js's own dimensions listener, which calls
    // renderAll() and rebuilds this whole card from scratch; a plain
    // unchecked checkbox on the OLD DOM node survives none of that, so
    // without this the facilitator's exclusion silently reset to
    // "everything included" on the very next unrelated board change.
    var excludedDraft = pendingDimExclusionsFor[sq.id] || {};
    var dimChecklistHtml = sortedDimensions().map(function(d){
      var checked = !excludedDraft[d.key];
      return '<label class="check-row" style="display:flex;align-items:center;gap:8px;margin:0 0 6px;">' +
        '<input type="checkbox" class="dim-include-checkbox" data-dim-key="'+esc(d.key)+'"'+(checked?' checked':'')+'>' +
        '<span dir="auto">'+esc(localizedDimText(d, "label"))+'</span>' +
      '</label>';
    }).join("");
    return '<div class="card session-card">' +
      '<h2>'+esc(t("retro.noSession.heading"))+'</h2>' +
      '<p class="hint">'+esc(t("retro.noSession.hint", {templateName: state.config.activeTemplateName||"Custom"}))+'</p>' +
      '<label class="check-row" style="display:flex;align-items:center;gap:8px;margin:0 0 12px;">' +
        '<input type="checkbox" id="pacingToggle">' +
        '<span dir="auto">'+esc(t("retro.startOptions.pacingLabel"))+'</span>' +
      '</label>' +
      '<p class="hint" style="margin:-6px 0 12px;">'+esc(t("retro.startOptions.pacingHint"))+'</p>' +
      '<details class="legend" style="margin:0 0 12px;">' +
        '<summary><span>'+esc(t("retro.startOptions.dimensionsSummary"))+'</span> <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></summary>' +
        '<div style="padding:0 4px 10px;">' +
          '<p class="hint" style="margin:0 0 8px;">'+esc(t("retro.startOptions.dimensionsHint"))+'</p>' +
          dimChecklistHtml +
          '<p class="hint" id="dimSelectHint" style="margin:6px 0 0;" hidden>'+esc(t("retro.startOptions.noDimensionsHint"))+'</p>' +
        '</div>' +
      '</details>' +
      '<button class="btn primary" id="startSessionBtn" type="button">'+esc(t("retro.startButton"))+'</button>' +
    '</div>';
  }
  // SEC-2: state.sessions is rebuilt wholesale from the relay's own,
  // necessarily secret-less, broad snapshot on every change (see db.js) --
  // the secret a join/co-facilitate link needs lives only in
  // relay-client.js's own knownCodes bookkeeping (see its secretForRoom()).
  var sessSecret = SquadPulseRelay.secretForRoom(sess.id) || "";
  var joinUrl = joinUrlFor(sessSecret);
  var coFacilitateUrl = coFacilitateUrlFor(sessSecret);
  var activeDims = retroDimensions(sess.dimensions);
  var revealMode = sess.revealMode || "hold";
  // RETRO-2: shown only for a session started with pacing on. `total` is
  // recomputed from `sess.dimensions` on every render rather than stored --
  // see helpers.js's pacingSequence() header comment for why that's safe
  // (a pure function of the same snapshot every device already has).
  // `currentQuestionIndex` ranges 0..total inclusive: 0..total-1 is a real
  // question; `total` itself is the "questioning finished" sentinel every
  // participant's own auto-submit watches for (retro-join.js) -- Previous
  // stays enabled there too, so the facilitator can still go back and let a
  // straggler catch up after finishing.
  var pacingHtml = "";
  var pacingSeq = pacingSequence(sess.dimensions);
  if(sess.pacingEnabled && pacingSeq.length){
    var qIdx = sess.currentQuestionIndex || 0;
    var atStart = qIdx <= 0;
    var atEnd = qIdx >= pacingSeq.length;
    var nextLabel = qIdx === pacingSeq.length - 1 ? t("retro.pacing.finishButton") : t("retro.pacing.nextButton");
    var qText = atEnd ? null : pacingQuestionText(activeDims, pacingSeq, qIdx);
    var questionTextHtml = qText
      ? '<p class="hint pacing-current-question" id="pacingQuestionText" style="margin:0 0 8px;font-weight:600;" dir="auto">'+esc(qText)+'</p>'
      : "";
    pacingHtml =
      questionTextHtml +
      '<div class="pacing-controls" style="display:flex;align-items:center;gap:10px;margin:0 0 10px;">' +
        '<button class="btn" id="pacingPrevBtn" type="button"'+(atStart?" disabled":"")+'>'+esc(t("retro.pacing.prevButton"))+'</button>' +
        '<span class="hint" id="pacingCounter" style="margin:0;">'+esc(atEnd ? t("retro.pacing.doneHint") : t("retro.pacing.counter", {current: qIdx+1, total: pacingSeq.length}))+'</span>' +
        (atEnd ? "" : '<button class="btn primary" id="pacingNextBtn" type="button">'+esc(nextLabel)+'</button>') +
      '</div>';
  }
  var liveHtml = "";
  if(activeDims.length){
    var responses = state.sessionResponses || [];
    var submittedCount = responses.length;
    var toggleHtml =
      '<div class="view-switch reveal-toggle" role="tablist" aria-label="'+esc(t("retro.reveal.ariaLabel"))+'" style="margin-top:8px;">' +
        '<button class="reveal-btn'+(revealMode==="hold"?" active":"")+'" data-reveal="hold" type="button" role="tab">'+esc(t("retro.reveal.hold"))+'</button>' +
        '<button class="reveal-btn'+(revealMode==="live"?" active":"")+'" data-reveal="live" type="button" role="tab">'+esc(t("retro.reveal.live"))+'</button>' +
      '</div>';
    var countLine = submittedCount===1 ? t("retro.countLine.one") : t("retro.countLine.many", {count: submittedCount});
    if(revealMode === "live"){
      var dimRowsHtml = activeDims.map(function(dim){
        var result = effectiveDimResult(dim, sess, responses);
        var pillWord = !result ? t("retro.live.waiting") : colorWordLocalized(result.color);
        var trendHtml = (result && (result.trend==="up" || result.trend==="down"))
          ? '<span class="dim-trend '+result.trend+'" title="'+esc(trendWordLocalized(result.trend))+'">'+trendIcon(result.trend)+'</span>' : '';
        var dimLabel = localizedDimText(dim, "label");
        return '<div class="live-dim-row">' +
          '<span class="dim-name" dir="auto">'+esc(dimLabel)+'</span>' +
          '<span class="live-dim-actions">' +
            (result && result.overridden ? '<span class="override-tag">'+esc(t("retro.live.overriddenTag"))+'</span>' : '') +
            '<span class="pill'+(result?(' '+result.color):' unscored')+'">'+esc(pillWord)+'</span>' +
            trendHtml +
            '<button class="icon-btn override-btn" data-override-dim="'+esc(dim.key)+'" type="button" title="'+esc(t("retro.live.overrideTitle"))+'" aria-label="'+esc(t("retro.live.overrideTitle"))+' '+esc(dimLabel)+'">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
            '</button>' +
          '</span>' +
        '</div>';
      }).join("");
      // One anonymous row per submitted teammate, banded per dysfunction --
      // collapsed by default since it's more granular than the consolidated
      // pills above, and only reachable at all while already in live mode.
      var respTableHtml = "";
      if(responses.length){
        var headHtml = activeDims.map(function(d){ return '<th dir="auto">'+esc(localizedDimText(d, "label"))+'</th>'; }).join("");
        var bodyHtml = responses.map(function(r, i){
          var cells = activeDims.map(function(d){
            var b = bandForResponse(d, r);
            var word = b ? colorWordLocalized(b) : "—";
            return '<td><span class="pill'+(b?(' '+b):' unscored')+'">'+esc(word)+'</span></td>';
          }).join("");
          return '<tr><th>'+esc(t("retro.live.responseRowLabel", {n: i+1}))+'</th>'+cells+'</tr>';
        }).join("");
        var seeResponsesText = responses.length===1 ? t("retro.live.seeResponsesOne") : t("retro.live.seeResponsesMany", {count: responses.length});
        respTableHtml =
          '<details class="legend resp-details" style="margin-top:10px;">' +
            '<summary><span>'+esc(seeResponsesText)+'</span> <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></summary>' +
            '<div style="padding:0 4px 10px;">' +
              '<div class="table-scroll"><table class="resp-table"><thead><tr><th></th>'+headHtml+'</tr></thead><tbody>'+bodyHtml+'</tbody></table></div>' +
            '</div>' +
          '</details>';
      }
      liveHtml =
        '<div class="live-block">' +
          '<div class="field-label" style="margin-top:0;">'+esc(t("retro.live.heading"))+'</div>' +
          '<p class="hint" style="margin:0 0 8px;">'+esc(countLine)+'</p>' +
          dimRowsHtml +
          respTableHtml +
          toggleHtml +
        '</div>';
    } else {
      liveHtml =
        '<div class="live-block">' +
          '<div class="field-label" style="margin-top:0;">'+esc(t("retro.held.heading"))+'</div>' +
          '<p class="hint" style="margin:0 0 0;">'+esc(countLine)+esc(t("retro.held.hint"))+'</p>' +
          toggleHtml +
        '</div>';
    }
  }
  var noteVal = sess.experimentNote || "";
  // RETRO-2 follow-up (PO review): "Saved" used to be a 1.8s timed flash
  // (window.__expNoteHintTimer, since removed) -- easy to miss, and worse,
  // could be silently wiped out mid-flash by an UNRELATED re-render (any
  // live sessions/responses update re-renders this whole card -- see
  // subscribeSessionResponses()), since it was hardcoded `hidden` in this
  // markup rather than derived from anything. savedExperimentNoteFor
  // (below, near startingSessionFor) is this device's own record of the
  // exact text it last successfully saved for this session; comparing it
  // against the session's own persisted note HERE, at render time, means
  // "Saved" stays correctly shown through any number of unrelated
  // re-renders, and (via #experimentNoteBox's own `input` listener in
  // bindSessionCardEvents) disappears the moment this device's note
  // differs from what's actually saved.
  if(!(sess.id in savedExperimentNoteFor)) savedExperimentNoteFor[sess.id] = noteVal;
  var noteIsSaved = noteVal !== "" && savedExperimentNoteFor[sess.id] === noteVal;
  var noteSaveFailed = !!noteSaveFailedFor[sess.id];
  var experimentHtml =
    '<div class="field-label" style="margin-top:14px;">'+esc(t("retro.experiment.heading"))+'</div>' +
    '<p class="hint" style="margin:0 0 8px;">'+esc(t("retro.experiment.hint"))+'</p>' +
    '<textarea class="note" id="experimentNoteBox" placeholder="'+esc(t("retro.experiment.placeholder"))+'" dir="auto">'+esc(noteVal)+'</textarea>' +
    '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:6px;">' +
      '<span class="hint" id="expNoteSavedHint" style="margin:0;"'+(noteIsSaved?"":" hidden")+'>'+esc(t("retro.experiment.saved"))+'</span>' +
      '<span class="hint error" id="expNoteSaveErrorHint" style="margin:0;"'+(noteSaveFailed?"":" hidden")+'>'+esc(t("retro.experiment.saveFailed"))+'</span>' +
      '<button class="btn" id="saveExperimentNoteBtn" type="button">'+esc(t("retro.experiment.saveButton"))+'</button>' +
    '</div>';
  var finishHtml = activeDims.length
    ? '<button class="btn primary" id="finishSessionBtn" type="button" style="margin-top:14px;">'+esc(t("retro.finishButton"))+'</button>'
    : "";
  // SEC-2: the join-code modal and the raw code display above are gone --
  // per the locked PO decision in STATUS.md, a retro session is joined only
  // by scanning its QR code or opening its link, so this block (previously
  // collapsed behind an "Or scan/share a link" <details>) is now the only
  // path and is shown directly, no longer collapsed by default.
  var securityNoticeHtml = '<p class="hint security-notice">'+esc(t("retro.shareSecurity.notice"))+'</p>';
  return '<div class="card session-card">' +
    '<h2>'+esc(t("retro.inProgressHeading"))+'</h2>' +
    '<p class="hint">'+esc(t("retro.retroLabel", {name: sess.templateName}))+'</p>' +
    pacingHtml +
    liveHtml +
    experimentHtml +
    '<div class="join-share-block" style="margin-top:14px;">' +
      '<div class="field-label" style="margin-top:0;">'+esc(t("retro.shareLink.summary"))+'</div>' +
      '<p class="hint" style="margin:0 0 10px;">'+esc(t("retro.shareLink.hint"))+'</p>' +
      '<div class="join-row">' +
        '<div class="qr-box" id="sessionQr"></div>' +
        '<div class="join-link-col">' +
          '<div class="field-label" style="margin-top:0;">'+esc(t("retro.shareLink.linkLabel"))+'</div>' +
          '<div class="join-link-row">' +
            '<input class="join-link-input" id="sessionJoinLink" type="text" readonly value="'+esc(joinUrl)+'" aria-label="'+esc(t("retro.shareLink.linkLabel"))+'">' +
            '<button class="btn" id="copyJoinLinkBtn" type="button">'+esc(t("retro.shareLink.copy"))+'</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      securityNoticeHtml +
    '</div>' +
    '<details class="legend" style="margin-top:8px;">' +
      '<summary><span>'+esc(t("retro.coFacilitate.summary"))+'</span> <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></summary>' +
      '<div style="padding:0 18px 16px;">' +
        '<p class="hint" style="margin:0 0 10px;">'+esc(t("retro.coFacilitate.hint"))+'</p>' +
        '<div class="join-row">' +
          '<div class="qr-box" id="coFacilitateQr"></div>' +
          '<div class="join-link-col">' +
            '<div class="field-label" style="margin-top:0;">'+esc(t("retro.coFacilitate.linkLabel"))+'</div>' +
            '<div class="join-link-row">' +
              '<input class="join-link-input" id="coFacilitateLink" type="text" readonly value="'+esc(coFacilitateUrl)+'" aria-label="'+esc(t("retro.coFacilitate.linkLabel"))+'">' +
              '<button class="btn" id="copyCoFacilitateLinkBtn" type="button">'+esc(t("retro.shareLink.copy"))+'</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        securityNoticeHtml +
      '</div>' +
    '</details>' +
    finishHtml +
    '<button class="btn danger" id="closeSessionBtn" type="button" style="margin-top:'+(finishHtml?"8px":"14px")+';">'+esc(t("retro.closeButton"))+'</button>' +
  '</div>';
}

// Tracks which squads have a start-session request in flight, independent
// of any one button element's own `disabled` attribute -- state.sessions
// changing at all (even a totally unrelated room's failed reconnect
// attempt) re-renders Squad view, which rebuilds this button from scratch
// via renderSessionCardHtml/bindSessionCardEvents. A plain `btn.disabled =
// true` on the OLD element survives none of that; this object does, so a
// re-render mid-request still shows the right "Starting…" state instead of
// quietly handing back a fresh, clickable button and inviting a second
// (third, ninth...) concurrent attempt.
var startingSessionFor = {};

// RETRO-2 follow-up (PO review): { [sessionId]: <text this device last
// successfully saved> }, read by renderSessionCardHtml() above to decide
// whether "Saved" shows -- see that comment for the full reasoning (the
// same "state change re-renders this card" problem startingSessionFor
// above solves, applied to the sprint-experiment note's save confirmation).
var savedExperimentNoteFor = {};

// Codex review (PR #35): { [sessionId]: true } for a device whose most
// recent save attempt was rejected, read by renderSessionCardHtml() the
// same way savedExperimentNoteFor is -- otherwise the failure hint would
// be hardcoded `hidden` in the markup again and vanish on the very next
// unrelated re-render, the exact bug class this file already fixed once
// for "Saved" itself.
var noteSaveFailedFor = {};

// RETRO-3: draft dimension-exclusion choices, kept OUTSIDE the DOM and
// keyed by squad id -- exactly the reason startingSessionFor (above)
// exists: state.dimensions changing at all (even a totally unrelated
// dimension, from this device or a co-facilitator's) fires db.js's own
// dimensions listener, which calls renderAll() and rebuilds this whole
// card from scratch (Codex review on PR #34, reproduced: exclude a
// dimension, trigger a board snapshot, and the checklist silently reset to
// all-checked). A plain unchecked checkbox on the OLD DOM node survives
// none of that; this object does, so renderSessionCardHtml() can restore
// exactly what the facilitator chose instead of defaulting back to
// "everything included." { [squadId]: { [dimKey]: true } } -- a key's mere
// presence means "excluded"; absent/false means included, matching an
// unchecked-by-default checklist needing no entries at all in the common
// case where nothing's excluded.
var pendingDimExclusionsFor = {};

function bindSessionCardEvents(sq){
  var startBtn = document.getElementById("startSessionBtn");
  if(startBtn){
    if(startingSessionFor[sq.id]){ startBtn.disabled = true; startBtn.textContent = "Starting…"; }
    // RETRO-3: a plain `change` listener per checkbox, not a re-render --
    // see renderSessionCardHtml()'s own comment on why. Runs once up front
    // too, so a board with every dimension pre-excluded by some future
    // caller (none exist today; every checkbox starts checked) doesn't show
    // a momentarily-enabled Start button before the first toggle.
    var dimCheckboxes = document.querySelectorAll(".dim-include-checkbox");
    if(dimCheckboxes.length){
      var updateDimSelectionValidity = function(){
        var anyChecked = Array.prototype.some.call(dimCheckboxes, function(cb){ return cb.checked; });
        startBtn.disabled = !anyChecked || !!startingSessionFor[sq.id];
        var hint = document.getElementById("dimSelectHint");
        if(hint) hint.hidden = anyChecked;
      };
      dimCheckboxes.forEach(function(cb){
        cb.addEventListener("change", function(){
          var draft = pendingDimExclusionsFor[sq.id] || (pendingDimExclusionsFor[sq.id] = {});
          if(cb.checked) delete draft[cb.getAttribute("data-dim-key")];
          else draft[cb.getAttribute("data-dim-key")] = true;
          updateDimSelectionValidity();
        });
      });
      updateDimSelectionValidity();
    }
    startBtn.addEventListener("click", function(){
      if(startingSessionFor[sq.id] || startBtn.disabled) return;
      startingSessionFor[sq.id] = true;
      startBtn.disabled = true;
      startBtn.textContent = t("retro.startingButton");
      var pacingToggle = document.getElementById("pacingToggle");
      var excludedDimKeys = Array.prototype.filter.call(dimCheckboxes, function(cb){ return !cb.checked; })
        .map(function(cb){ return cb.getAttribute("data-dim-key"); });
      startSession(sq, pacingToggle && pacingToggle.checked, excludedDimKeys).then(function(){
        delete startingSessionFor[sq.id];
        delete pendingDimExclusionsFor[sq.id];
      }).catch(function(err){
        delete startingSessionFor[sq.id];
        startBtn.disabled = false;
        startBtn.textContent = t("retro.startButton");
        openConfirm(
          t("retro.confirmStart.errorTitle"),
          (err && err.message) ? err.message : t("retro.coFacilitate.errorFallback"),
          function(){}, t("common.ok")
        );
      });
    });
  }

  var closeBtn = document.getElementById("closeSessionBtn");
  if(closeBtn) closeBtn.addEventListener("click", function(){
    var sess = openSessionForSquad(sq.id);
    if(!sess) return;
    openConfirm(
      t("retro.confirmClose.title"),
      t("retro.confirmClose.message", {name: sq.name}),
      function(){ closeSession(sess.id); },
      t("retro.confirmClose.button")
    );
  });

  var copyBtn = document.getElementById("copyJoinLinkBtn");
  if(copyBtn) copyBtn.addEventListener("click", function(){
    var input = document.getElementById("sessionJoinLink");
    if(!input) return;
    input.focus(); input.select();
    try{ navigator.clipboard && navigator.clipboard.writeText(input.value); }catch(e){ /* select() above still lets the user copy manually */ }
  });

  var qrBox = document.getElementById("sessionQr");
  if(qrBox){
    var sess = openSessionForSquad(sq.id);
    if(sess) renderQrInto(qrBox, joinUrlFor(SquadPulseRelay.secretForRoom(sess.id) || ""));
  }

  var copyCoFacilitateBtn = document.getElementById("copyCoFacilitateLinkBtn");
  if(copyCoFacilitateBtn) copyCoFacilitateBtn.addEventListener("click", function(){
    var input = document.getElementById("coFacilitateLink");
    if(!input) return;
    input.focus(); input.select();
    try{ navigator.clipboard && navigator.clipboard.writeText(input.value); }catch(e){ /* select() above still lets the user copy manually */ }
  });

  var coFacilitateQrBox = document.getElementById("coFacilitateQr");
  if(coFacilitateQrBox){
    var coFacSess = openSessionForSquad(sq.id);
    if(coFacSess) renderQrInto(coFacilitateQrBox, coFacilitateUrlFor(SquadPulseRelay.secretForRoom(coFacSess.id) || ""));
  }

  document.querySelectorAll(".reveal-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var sess = openSessionForSquad(sq.id);
      if(!sess) return;
      setRevealMode(sess, btn.getAttribute("data-reveal"));
    });
  });

  var pacingPrevBtn = document.getElementById("pacingPrevBtn");
  if(pacingPrevBtn) pacingPrevBtn.addEventListener("click", function(){
    var sess = openSessionForSquad(sq.id);
    if(!sess) return;
    setCurrentQuestionIndex(sess, (sess.currentQuestionIndex || 0) - 1);
  });
  var pacingNextBtn = document.getElementById("pacingNextBtn");
  if(pacingNextBtn) pacingNextBtn.addEventListener("click", function(){
    var sess = openSessionForSquad(sq.id);
    if(!sess) return;
    setCurrentQuestionIndex(sess, (sess.currentQuestionIndex || 0) + 1);
  });

  document.querySelectorAll(".override-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var sess = openSessionForSquad(sq.id);
      if(!sess) return;
      openSessionOverrideEditor(sess, btn.getAttribute("data-override-dim"));
    });
  });

  var saveNoteBtn = document.getElementById("saveExperimentNoteBtn");
  var expNoteBox = document.getElementById("experimentNoteBox");
  var expNoteHint = document.getElementById("expNoteSavedHint");
  // RETRO-2 follow-up (PO review): live dirty-detection while typing --
  // without this, "Saved" (shown by renderSessionCardHtml() at render time,
  // or set true below right after a click) would keep claiming the note is
  // saved even after the facilitator starts editing it again.
  if(expNoteBox && expNoteHint) expNoteBox.addEventListener("input", function(){
    var sess = openSessionForSquad(sq.id);
    if(!sess) return;
    expNoteHint.hidden = savedExperimentNoteFor[sess.id] !== expNoteBox.value;
  });
  if(saveNoteBtn) saveNoteBtn.addEventListener("click", function(){
    var sess = openSessionForSquad(sq.id);
    var box = document.getElementById("experimentNoteBox");
    if(!sess || !box) return;
    var text = box.value.trim();
    delete noteSaveFailedFor[sess.id];
    var errHint = document.getElementById("expNoteSaveErrorHint");
    if(errHint) errHint.hidden = true;
    // Codex review (PR #35): the "Saved" hint used to be shown -- and
    // savedExperimentNoteFor recorded -- immediately on click, without
    // ever waiting to see whether the write actually landed. Await the
    // save's own promise and only claim "saved" once it resolves; a
    // rejected write (relay down, a stale/missing session doc) instead
    // records the failure in noteSaveFailedFor (read at render time, same
    // pattern as savedExperimentNoteFor) so the failure hint survives an
    // unrelated re-render instead of being wiped like "Saved" itself used
    // to be, and never gets papered over with a stale "Saved".
    saveExperimentNote(sess.id, text).then(function(){
      savedExperimentNoteFor[sess.id] = text;
      // Codex review (PR #35, second pass): a save's own completion doesn't
      // mean the box still shows what it just saved -- the facilitator can
      // (and did, in the reported repro) type something newer while this
      // exact write was still in flight. Only claim "Saved" if the box's
      // CURRENT value still matches the text this completion actually
      // persisted; otherwise leave it exactly as the `input` listener
      // above already left it for the now-newer, unsaved text.
      var currentBox = document.getElementById("experimentNoteBox");
      var hint = document.getElementById("expNoteSavedHint");
      if(hint) hint.hidden = !currentBox || currentBox.value !== text;
    }).catch(function(){
      noteSaveFailedFor[sess.id] = true;
      var errHint2 = document.getElementById("expNoteSaveErrorHint");
      if(errHint2) errHint2.hidden = false;
    });
  });

  var finishBtn = document.getElementById("finishSessionBtn");
  if(finishBtn) finishBtn.addEventListener("click", function(){
    var sess = openSessionForSquad(sq.id);
    if(!sess) return;
    var dims = retroDimensions(sess.dimensions);
    var responses = state.sessionResponses || [];
    var results = dims.map(function(dim){
      return { dim: dim, result: effectiveDimResult(dim, sess, responses) };
    }).filter(function(x){ return !!x.result; });
    if(!results.length){
      openConfirm(
        t("retro.confirmFinishEmpty.title"),
        t("retro.confirmFinishEmpty.message", {name: sq.name}),
        function(){ closeSession(sess.id); },
        t("retro.confirmClose.button")
      );
      return;
    }
    var summary = results.map(function(x){
      return localizedDimText(x.dim, "label") + ": " + colorWordLocalized(x.result.color) + (x.result.overridden ? t("retro.confirmFinish.overriddenSuffix") : "");
    }).join(", ");
    openConfirm(
      t("retro.confirmFinish.title"),
      t("retro.confirmFinish.message", {name: sq.name, summary: summary}),
      function(){ finishRetroAndApply(sq, sess, results); },
      t("retro.confirmFinish.button")
    );
  });

  subscribeSessionResponses(openSessionForSquad(sq.id));
}

// Manual live/hold switch for the facilitator's aggregate view -- there's
// no roster/headcount anywhere in this app, so "everyone's submitted"
// isn't something the board can detect on its own; the SM decides when to
// reveal, same as they'd decide out loud in a real room.
function setRevealMode(sess, mode){
  if(mode!=="live" && mode!=="hold") return;
  liveOr(function(){
    return state.db.collection("sessions").doc(sess.id).update({ revealMode: mode }).catch(function(err){
      diag("Set reveal mode failed: " + (err && err.code ? err.code : String(err)));
    });
  }, function(){
    sess.revealMode = mode;
    renderSquadView();
  });
}

// RETRO-2: moves the paced session's shared "current question" pointer.
// Clamped to [0, pacingSequence(sess.dimensions).length] -- the upper bound
// is the "questioning finished" sentinel every participant's join screen
// watches for (see retro-join.js), not an out-of-range value to guard
// against; going lower than 0 (Previous past the first question) is simply
// a no-op, same shape bindSessionCardEvents()'s own disabled-Prev-button
// already prevents from the UI, but checked here too since this is the one
// function that actually writes the shared value.
function setCurrentQuestionIndex(sess, index){
  var total = pacingSequence(sess.dimensions).length;
  var clamped = Math.max(0, Math.min(index, total));
  liveOr(function(){
    return state.db.collection("sessions").doc(sess.id).update({ currentQuestionIndex: clamped }).catch(function(err){
      diag("Set current question index failed: " + (err && err.code ? err.code : String(err)));
    });
  }, function(){
    sess.currentQuestionIndex = clamped;
    renderSquadView();
  });
}

// ---------- facilitator override + sprint note (Story 7-8) ----------
// An override lives on the session doc itself (sessions/{id}.overrides.{dimKey}),
// not on the squad -- it only takes effect on the squad's real rating once
// the SM finishes the retro (Story 9). null/absent means "use whatever the
// live majority/calmer-tie consolidation says."
function setSessionOverride(sessionId, dimKey, val){
  liveOr(function(){
    var patch = { overrides:{} };
    patch.overrides[dimKey] = val;
    return state.db.collection("sessions").doc(sessionId).update(patch).catch(function(err){
      diag("Set override failed: " + (err && err.code ? err.code : String(err)));
    });
  }, function(){
    var sess = state.sessions.filter(function(s){ return s.id===sessionId; })[0];
    if(sess){
      sess.overrides = Object.assign({}, sess.overrides);
      sess.overrides[dimKey] = val;
    }
  });
}
function clearSessionOverride(sessionId, dimKey){ setSessionOverride(sessionId, dimKey, null); }

function openSessionOverrideEditor(sess, dimKey){
  // look the dimension up in the SESSION'S OWN snapshot, not the live board
  // -- the board's template may have moved on since this retro started.
  var d = (sess.dimensions||[]).filter(function(x){ return x.key===dimKey; })[0];
  if(!d) return;
  var responses = state.sessionResponses || [];
  var computed = effectiveDimResult(d, { overrides:{} }, responses);
  var existingOverride = sess.overrides && sess.overrides[dimKey];
  state.editingCell = null;
  state.editingOverride = {
    sessionId: sess.id, dimKey: dimKey,
    color: (existingOverride && existingOverride.color) || (computed && computed.color) || "unscored",
    trend: (existingOverride && existingOverride.trend) || "flat",
    note: (existingOverride && existingOverride.note) || ""
  };
  document.getElementById("modalTitle").textContent = localizedDimText(d, "label");
  document.getElementById("modalSquadline").textContent = t("retro.override.squadline");
  document.getElementById("modalGreen").textContent = localizedDimText(d, "green") || "";
  document.getElementById("modalRed").textContent = localizedDimText(d, "red") || "";
  var noteBox = document.getElementById("modalNote");
  noteBox.value = state.editingOverride.note;
  noteBox.placeholder = t("retro.override.notePlaceholder");
  updateSwatchSelection();
  updateTrendSelection();
  document.getElementById("modalResetOverride").hidden = !existingOverride;
  backdrop.hidden = false;
  noteBox.focus({preventScroll:true});
}

// Sprint-experiment note is saved explicitly (a Save button), not per
// keystroke -- the sessions listener re-renders this whole card on every
// remote change, which would otherwise yank focus out of the textarea
// while someone's still typing.
function saveExperimentNote(sessionId, text){
  // Returns the write's own promise -- rejecting, not swallowing, on
  // failure -- so the caller (the Save button's click handler) can tell a
  // real persisted save from one that never landed. See Codex's PR #35
  // review: this used to catch-and-log only, which meant the promise
  // always resolved and the caller had no way to know the write failed.
  return liveOr(function(){
    return state.db.collection("sessions").doc(sessionId).update({ experimentNote: text }).catch(function(err){
      diag("Save experiment note failed: " + (err && err.code ? err.code : String(err)));
      throw err;
    });
  }, function(){
    var sess = state.sessions.filter(function(s){ return s.id===sessionId; })[0];
    if(sess) sess.experimentNote = text;
    return Promise.resolve();
  });
}

// ---------- finish retro (Story 9) ----------
// Writes the (possibly overridden) consolidated result for each scored
// dimension into the squad's own rating -- the same field Tribe view
// already reads -- then closes the session like a normal close.
// RETRO-1 (STATUS.md's "Facilitated retro backlog"): also snapshots this
// finish onto the squad itself as `lastRetro` -- finishedAt, the sprint
// experiment note, and each dimension's result INCLUDING whether it was
// manually overridden (effectiveDimResult()'s own `overridden` flag,
// otherwise lost the moment the session closes and its doc eventually
// expires via the relay's room-empty grace period). This is what makes a
// finished retro's own context -- not just its resulting ratings --
// portable through JSON board export/import (board-export.js/board-import-*.js).
function finishRetroAndApply(sq, sess, results){
  sq.dimensions = Object.assign({}, sq.dimensions);
  var patchedKeys = [];
  var lastRetroDimensions = {};
  results.forEach(function(x){
    var existing = sq.dimensions[x.dim.key] || {};
    sq.dimensions[x.dim.key] = { color: x.result.color, trend: x.result.trend, note: existing.note || "" };
    patchedKeys.push(x.dim.key);
    lastRetroDimensions[x.dim.key] = { color: x.result.color, trend: x.result.trend, overridden: !!x.result.overridden };
  });
  var lastRetro = { finishedAt: nowIso(), experimentNote: sess.experimentNote || "", dimensions: lastRetroDimensions };
  sq.lastRetro = lastRetro;
  if(patchedKeys.length) persistDimensionRatings(sq, patchedKeys, { lastRetro: lastRetro });
  closeSession(sess.id);
  renderAll();
}

// ---------- live facilitator tally (anonymous submissions for the session
// currently shown in Squad view) ----------
// A doc-level onSnapshot on the session itself (see listenJoinSession in
// retro-join.js) wouldn't see these -- responses live in their own
// subcollection so that submitting an answer never touches, and can't
// race, the session doc.
var sessionResponsesUnsub = null;
var sessionResponsesFor = null;
function subscribeSessionResponses(sess){
  if(!sess){
    if(sessionResponsesUnsub){ sessionResponsesUnsub(); sessionResponsesUnsub = null; }
    sessionResponsesFor = null;
    state.sessionResponses = [];
    return;
  }
  if(sessionResponsesFor === sess.id) return; // already watching this session
  if(sessionResponsesUnsub){ sessionResponsesUnsub(); sessionResponsesUnsub = null; }
  sessionResponsesFor = sess.id;
  state.sessionResponses = [];
  if(!(state.live && state.db)) return;
  sessionResponsesUnsub = state.db.collection("sessions").doc(sess.id).collection("responses").onSnapshot(function(snap){
    state.sessionResponses = snap.docs.map(function(d){ return d.data(); });
    if(state.ui.view==="squad") renderSquadView();
  }, function(err){
    diag("Responses listener error: " + (err && err.code ? err.code : String(err)));
  });
}

// Renders a QR code as inline SVG via the bundled qrcode-generator library
// (kept inline rather than loaded from a CDN, so the join link still works
// even if a live retro session has no route to an external script host).
function renderQrInto(el, text){
  try{
    var qr = qrcode(0, "M"); // typeNumber 0 = auto-pick the smallest size that fits
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize:4, margin:8, scalable:true });
  }catch(e){
    el.innerHTML = '<p class="hint" style="margin:0;padding:8px;">QR unavailable &mdash; use the link.</p>';
    diag("QR render failed: " + (e && e.message ? e.message : String(e)));
  }
}
