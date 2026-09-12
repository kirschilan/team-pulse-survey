"use strict";


// ---------- retro sessions (live, facilitated) -- FACILITATOR side ----------
// Everything here runs on the device that started the session: the session
// card on Squad view, starting/closing it, the live reveal toggle and
// per-dimension override, the sprint-experiment note, finishing and
// applying results into the squad's own ratings, and the live tally of
// anonymous submissions. The PARTICIPANT'S device -- the join screen a
// teammate answers on -- never runs any of this; see retro-join.js for
// that half. The two share almost no code (bandForResponse/
// effectiveDimResult/etc. in helpers.js are the closest thing to overlap),
// which is what makes this a clean split rather than an arbitrary one.
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

function startSession(sq){
  // snapshot dimensions the same way saveCurrentAsTemplate()/loadTemplate()
  // do, carrying statements/scoreBands/strategies along for whichever
  // future step reads them (nothing does yet)
  var dimsSnapshot = sortedDimensions().map(function(d){
    var spec = { key:d.key, label:d.label, green:d.green||"", red:d.red||"", order:d.order||0 };
    if(isStatementDimension(d)) spec.statements = d.statements;
    if(d.scoreBands) spec.scoreBands = d.scoreBands;
    if(d.strategies && d.strategies.length) spec.strategies = d.strategies;
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
  var code = uniqueSessionCode();
  return liveOr(function(){
    return state.db.collection("sessions").doc(code).set(payload).then(function(){
      diag("Started retro session " + code + " for squad " + sq.id);
    }).catch(function(err){
      diag("Start session failed: " + (err && err.code ? err.code : String(err)));
      throw err;
    });
  }, function(){
    state.sessions.push(Object.assign({ id:code }, payload));
    renderSquadView();
    return Promise.resolve();
  });
}

// Short, human-typeable session codes -- doubles as the session doc's id,
// so joining by code needs no separate lookup index. Excludes visually
// ambiguous characters (0/O, 1/I/L) since this gets read off a screen and
// typed on a phone. Used as the PRIMARY join method (see the header's
// "Join a retro" button): the QR/link is a secondary convenience that some
// phones' camera-to-app handoff doesn't carry a query string through, so
// the code has to work standalone.
var SESSION_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function generateSessionCode(){
  var code = "";
  for(var i=0;i<6;i+=1) code += SESSION_CODE_ALPHABET[Math.floor(Math.random()*SESSION_CODE_ALPHABET.length)];
  return code;
}
function uniqueSessionCode(){
  var code;
  do { code = generateSessionCode(); } while(state.sessions.some(function(s){ return s.id===code; }));
  return code;
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

function renderSessionCardHtml(sq){
  var sess = openSessionForSquad(sq.id);
  if(!sess){
    return '<div class="card session-card">' +
      '<h2>Retro session</h2>' +
      '<p class="hint">Start a live session using the board&rsquo;s current template (&ldquo;'+esc(state.config.activeTemplateName||"Custom")+'&rdquo;) &mdash; teammates can join and answer on their own device.</p>' +
      '<button class="btn primary" id="startSessionBtn" type="button">Start retro session</button>' +
    '</div>';
  }
  var joinUrl = joinUrlFor(sess.id);
  var activeDims = retroDimensions(sess.dimensions);
  var revealMode = sess.revealMode || "hold";
  var liveHtml = "";
  if(activeDims.length){
    var responses = state.sessionResponses || [];
    var submittedCount = responses.length;
    var toggleHtml =
      '<div class="view-switch reveal-toggle" role="tablist" aria-label="Reveal mode" style="margin-top:8px;">' +
        '<button class="reveal-btn'+(revealMode==="hold"?" active":"")+'" data-reveal="hold" type="button" role="tab">Hold results</button>' +
        '<button class="reveal-btn'+(revealMode==="live"?" active":"")+'" data-reveal="live" type="button" role="tab">Show live</button>' +
      '</div>';
    var countLine = submittedCount + ' ' + (submittedCount===1?'teammate has':'teammates have') + ' submitted so far.';
    if(revealMode === "live"){
      var dimRowsHtml = activeDims.map(function(dim){
        var result = effectiveDimResult(dim, sess, responses);
        var pillWord = !result ? "Waiting…" : result.color==="good" ? "Green" : result.color==="warn" ? "Yellow" : "Red";
        var trendHtml = (result && (result.trend==="up" || result.trend==="down"))
          ? '<span class="dim-trend '+result.trend+'" title="'+trendWord(result.trend)+'">'+trendIcon(result.trend)+'</span>' : '';
        return '<div class="live-dim-row">' +
          '<span class="dim-name" dir="auto">'+esc(dim.label)+'</span>' +
          '<span class="live-dim-actions">' +
            (result && result.overridden ? '<span class="override-tag">Overridden</span>' : '') +
            '<span class="pill'+(result?(' '+result.color):' unscored')+'">'+pillWord+'</span>' +
            trendHtml +
            '<button class="icon-btn override-btn" data-override-dim="'+esc(dim.key)+'" type="button" title="Override this result" aria-label="Override '+esc(dim.label)+'">' +
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
        var headHtml = activeDims.map(function(d){ return '<th dir="auto">'+esc(d.label)+'</th>'; }).join("");
        var bodyHtml = responses.map(function(r, i){
          var cells = activeDims.map(function(d){
            var b = bandForResponse(d, r);
            var word = b==="good"?"Green":b==="warn"?"Yellow":b==="crit"?"Red":"—";
            return '<td><span class="pill'+(b?(' '+b):' unscored')+'">'+word+'</span></td>';
          }).join("");
          return '<tr><th>Response '+(i+1)+'</th>'+cells+'</tr>';
        }).join("");
        respTableHtml =
          '<details class="legend resp-details" style="margin-top:10px;">' +
            '<summary>See all '+responses.length+' response'+(responses.length===1?"":"s")+' <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></summary>' +
            '<div style="padding:0 4px 10px;">' +
              '<div class="table-scroll"><table class="resp-table"><thead><tr><th></th>'+headHtml+'</tr></thead><tbody>'+bodyHtml+'</tbody></table></div>' +
            '</div>' +
          '</details>';
      }
      liveHtml =
        '<div class="live-block">' +
          '<div class="field-label" style="margin-top:0;">Live results</div>' +
          '<p class="hint" style="margin:0 0 8px;">'+countLine+'</p>' +
          dimRowsHtml +
          respTableHtml +
          toggleHtml +
        '</div>';
    } else {
      liveHtml =
        '<div class="live-block">' +
          '<div class="field-label" style="margin-top:0;">Results held</div>' +
          '<p class="hint" style="margin:0 0 0;">'+countLine+' Switch to &ldquo;Show live&rdquo; any time to see the consolidated results as they come in.</p>' +
          toggleHtml +
        '</div>';
    }
  }
  var noteVal = sess.experimentNote || "";
  var experimentHtml =
    '<div class="field-label" style="margin-top:14px;">Sprint experiment</div>' +
    '<p class="hint" style="margin:0 0 8px;">What will the team try differently next sprint?</p>' +
    '<textarea class="note" id="experimentNoteBox" placeholder="e.g. Pair on the riskiest story each day" dir="auto">'+esc(noteVal)+'</textarea>' +
    '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:6px;">' +
      '<span class="hint" id="expNoteSavedHint" style="margin:0;" hidden>Saved</span>' +
      '<button class="btn" id="saveExperimentNoteBtn" type="button">Save note</button>' +
    '</div>';
  var finishHtml = activeDims.length
    ? '<button class="btn primary" id="finishSessionBtn" type="button" style="margin-top:14px;">Finish retro &amp; apply results</button>'
    : "";
  return '<div class="card session-card">' +
    '<h2>Retro session in progress</h2>' +
    '<p class="hint">Retro: &ldquo;'+esc(sess.templateName)+'&rdquo;.</p>' +
    '<div class="session-code-block">' +
      '<div class="field-label" style="margin-top:0;">Session code</div>' +
      '<div class="session-code">'+esc(sess.id)+'</div>' +
      '<p class="hint" style="margin:8px 0 0;">Have teammates open Squad Pulse and tap &ldquo;Join a retro&rdquo; up top, then type this code in.</p>' +
    '</div>' +
    liveHtml +
    experimentHtml +
    '<details class="legend" style="margin-top:14px;">' +
      '<summary>Or scan/share a link <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></summary>' +
      '<div style="padding:0 18px 16px;">' +
        '<p class="hint" style="margin:0 0 10px;">On some phones, scanning this opens the Claude app to the regular board instead of the retro &mdash; if that happens, use the session code above instead.</p>' +
        '<div class="join-row">' +
          '<div class="qr-box" id="sessionQr"></div>' +
          '<div class="join-link-col">' +
            '<div class="field-label" style="margin-top:0;">Join link</div>' +
            '<div class="join-link-row">' +
              '<input class="join-link-input" id="sessionJoinLink" type="text" readonly value="'+esc(joinUrl)+'" aria-label="Join link">' +
              '<button class="btn" id="copyJoinLinkBtn" type="button">Copy</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</details>' +
    finishHtml +
    '<button class="btn danger" id="closeSessionBtn" type="button" style="margin-top:'+(finishHtml?"8px":"14px")+';">Close session</button>' +
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
      startBtn.textContent = "Starting…";
      startSession(sq).then(function(){
        delete startingSessionFor[sq.id];
      }).catch(function(err){
        delete startingSessionFor[sq.id];
        startBtn.disabled = false;
        startBtn.textContent = "Start retro session";
        openConfirm(
          "Couldn’t start the retro session",
          (err && err.message) ? err.message : "Something went wrong reaching the relay. Check the diagnostic log below for details.",
          function(){}, "OK"
        );
      });
    });
  }

  var closeBtn = document.getElementById("closeSessionBtn");
  if(closeBtn) closeBtn.addEventListener("click", function(){
    var sess = openSessionForSquad(sq.id);
    if(!sess) return;
    openConfirm(
      "Close this retro session?",
      "Ends the session for everyone with the link. This does not change any of " + sq.name + "’s existing ratings.",
      function(){ closeSession(sess.id); },
      "Close session"
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
    if(sess) renderQrInto(qrBox, joinUrlFor(sess.id));
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
        "Finish this retro?",
        "No submissions or overrides yet, so " + sq.name + "’s ratings won’t change. This just closes the session.",
        function(){ closeSession(sess.id); },
        "Close session"
      );
      return;
    }
    var summary = results.map(function(x){
      return x.dim.label + ": " + colorWord(x.result.color) + (x.result.overridden ? " (overridden)" : "");
    }).join(", ");
    openConfirm(
      "Finish this retro?",
      "Writes these results into " + sq.name + "’s ratings, then closes the session — " + summary,
      function(){ finishRetroAndApply(sq, sess, results); },
      "Finish & apply"
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
  state.editing = {
    mode: "session", sessionId: sess.id, dimKey: dimKey,
    color: (existingOverride && existingOverride.color) || (computed && computed.color) || "unscored",
    trend: (existingOverride && existingOverride.trend) || "flat",
    note: (existingOverride && existingOverride.note) || ""
  };
  document.getElementById("modalTitle").textContent = d.label;
  document.getElementById("modalSquadline").textContent = "Overriding this retro’s consolidated result";
  document.getElementById("modalGreen").textContent = d.green||"";
  document.getElementById("modalRed").textContent = d.red||"";
  var noteBox = document.getElementById("modalNote");
  noteBox.value = state.editing.note;
  noteBox.placeholder = "Why override this? (optional)";
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
function finishRetroAndApply(sq, sess, results){
  sq.dimensions = Object.assign({}, sq.dimensions);
  var patchedKeys = [];
  results.forEach(function(x){
    var existing = sq.dimensions[x.dim.key] || {};
    sq.dimensions[x.dim.key] = { color: x.result.color, trend: x.result.trend, note: existing.note || "" };
    patchedKeys.push(x.dim.key);
  });
  if(patchedKeys.length) persistDimensionRatings(sq, patchedKeys);
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
// (kept inline rather than loaded from a CDN, so the join code still works
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
