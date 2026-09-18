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

function startSession(sq){
  // snapshot dimensions the same way saveCurrentAsTemplate()/loadTemplate()
  // do, carrying statements/scoreBands/strategies (and any Hebrew
  // translation the dimension has -- see state.js's localizedDimText())
  // along so the retro flow can render this session correctly translated
  // (Story 11 / the retro-statement-translation follow-up).
  var dimsSnapshot = sortedDimensions().map(function(d){
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
    createdAt: nowIso()
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

// This card renders inside #viewSquad, which Story 4 made i18n-supported
// (flips to dir="rtl" under Hebrew) -- Story 11 brought this flow's own
// chrome under translation too, so it now inherits that flip like the rest
// of Squad view, rather than opting out with its own dir="ltr" the way it
// did before this story.
function renderSessionCardHtml(sq){
  var sess = openSessionForSquad(sq.id);
  if(!sess){
    return '<div class="card session-card">' +
      '<h2>'+esc(t("retro.noSession.heading"))+'</h2>' +
      '<p class="hint">'+esc(t("retro.noSession.hint", {templateName: state.config.activeTemplateName||"Custom"}))+'</p>' +
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
  var experimentHtml =
    '<div class="field-label" style="margin-top:14px;">'+esc(t("retro.experiment.heading"))+'</div>' +
    '<p class="hint" style="margin:0 0 8px;">'+esc(t("retro.experiment.hint"))+'</p>' +
    '<textarea class="note" id="experimentNoteBox" placeholder="'+esc(t("retro.experiment.placeholder"))+'" dir="auto">'+esc(noteVal)+'</textarea>' +
    '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:6px;">' +
      '<span class="hint" id="expNoteSavedHint" style="margin:0;" hidden>'+esc(t("retro.experiment.saved"))+'</span>' +
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

function bindSessionCardEvents(sq){
  var startBtn = document.getElementById("startSessionBtn");
  if(startBtn){
    if(startingSessionFor[sq.id]){ startBtn.disabled = true; startBtn.textContent = "Starting…"; }
    startBtn.addEventListener("click", function(){
      if(startingSessionFor[sq.id]) return;
      startingSessionFor[sq.id] = true;
      startBtn.disabled = true;
      startBtn.textContent = t("retro.startingButton");
      startSession(sq).then(function(){
        delete startingSessionFor[sq.id];
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

  document.querySelectorAll(".override-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var sess = openSessionForSquad(sq.id);
      if(!sess) return;
      openSessionOverrideEditor(sess, btn.getAttribute("data-override-dim"));
    });
  });

  var saveNoteBtn = document.getElementById("saveExperimentNoteBtn");
  if(saveNoteBtn) saveNoteBtn.addEventListener("click", function(){
    var sess = openSessionForSquad(sq.id);
    var box = document.getElementById("experimentNoteBox");
    if(!sess || !box) return;
    saveExperimentNote(sess.id, box.value.trim());
    var hint = document.getElementById("expNoteSavedHint");
    if(hint){
      hint.hidden = false;
      clearTimeout(window.__expNoteHintTimer);
      window.__expNoteHintTimer = setTimeout(function(){ hint.hidden = true; }, 1800);
    }
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
  liveOr(function(){
    return state.db.collection("sessions").doc(sessionId).update({ experimentNote: text }).catch(function(err){
      diag("Save experiment note failed: " + (err && err.code ? err.code : String(err)));
    });
  }, function(){
    var sess = state.sessions.filter(function(s){ return s.id===sessionId; })[0];
    if(sess) sess.experimentNote = text;
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
