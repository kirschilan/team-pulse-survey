(function(){
  "use strict";

  var DIAG_LINES = [];
  function diag(msg){
    var t = new Date().toISOString().slice(11,19);
    DIAG_LINES.push("[" + t + "] " + msg);
    if (DIAG_LINES.length > 40) DIAG_LINES.shift();
    var el = document.getElementById("diagLog");
    if (el) el.textContent = DIAG_LINES.join("\n");
  }

  // Starter dimension set (Spotify Squad Health Check-inspired). IDs match
  // what this board is seeded with in the live "dimensions" collection, and
  // also match the keys already used inside each squad's stored ratings --
  // keep these ids stable so existing ratings never get orphaned.
  var PLACEHOLDER_DIMENSIONS = [
    { key:"release",   label:"Easy to release", order:1,
      green:"Releasing is routine, low-risk, and low-drama.",
      red:"Releases are rare, risky, or dreaded events." },
    { key:"process",    label:"Suitable process", order:2,
      green:"Our way of working fits us, and we can tune it ourselves.",
      red:"Process feels imposed, bureaucratic, or mismatched to how we work." },
    { key:"techquality",label:"Tech quality", order:3,
      green:"We're proud of our codebase and engineering practices.",
      red:"Quality is a constant source of pain and slow-down." },
    { key:"value",      label:"Value", order:4,
      green:"What we ship clearly matters to users and the business.",
      red:"We're not confident our work is moving the needle." },
    { key:"speed",      label:"Speed", order:5,
      green:"We get things done quickly, without cutting corners.",
      red:"Progress feels slow and heavy." },
    { key:"mission",    label:"Mission", order:6,
      green:"We know why we exist and where we're headed.",
      red:"The mission is vague, or keeps shifting under us." },
    { key:"fun",        label:"Fun", order:7,
      green:"We genuinely enjoy working together.",
      red:"Coming to work feels like a grind." },
    { key:"learning",   label:"Learning", order:8,
      green:"We're growing, trying new things, and sharing what we learn.",
      red:"We're stagnant — same patterns, no time to learn." },
    { key:"support",    label:"Support", order:9,
      green:"We get the help we need, when we need it, from the org around us.",
      red:"We're on our own — blocked, or ignored." },
    { key:"pawns",      label:"Pawns or players", order:10,
      green:"We help decide what to build and how.",
      red:"We just execute a backlog someone else wrote." },
    { key:"teamwork",   label:"Teamwork", order:11,
      green:"We function as one team, not a collection of individuals.",
      red:"We're fragmented, siloed, or in open conflict." },
    { key:"codebase",   label:"Codebase health", order:12,
      green:"The codebase is something we can safely and confidently change.",
      red:"Every change feels risky, brittle, or full of surprises." }
  ];

  var SPOTIFY_ATTRIBUTION = "Dimensions adapted from the Spotify Squad Health Check model (Henrik Kniberg & Spotify, via Ben Linders’ agile self-assessment survey). Scoring, weighting and the investment ranking here are Dr. Agile’s own.";

  var DEFAULT_CONFIG = { unit:"Squad", unitPlural:"Squads", activeTemplateName:"Spotify Squad Health Check", attribution: SPOTIFY_ATTRIBUTION };

  // ---------- starter templates (built in, not stored in the live "templates"
  // collection -- always offered, never deletable, and never cost a db write
  // just by existing). Each "scored" dimension below carries a bank of
  // statements plus scoreBands: this is content only for now -- nothing reads
  // .statements yet, so loading this template still works exactly like any
  // other (each dimension just starts unscored, rated the regular way via the
  // swatches). A later change teaches the rating flow to render these
  // statements as a mini 1/2/3 survey and compute the color from the sum
  // instead; the data is here now so that flow has something to load.
  var FIVE_DYSFUNCTIONS_TEMPLATE = {
    id: "starter-5dysfunctions",
    starter: true,
    name: "The Five Dysfunctions of a Team",
    unit: "Squad", unitPlural: "Squads",
    attribution: "Adapted from Patrick Lencioni’s The Five Dysfunctions of a Team assessment (The Table Group). The 8–9 / 6–7 / 3–5 scoring bands are from the original assessment; consolidating multiple teammates’ answers into one board rating, and the facilitator override, are Dr. Agile’s own.",
    dimensions: [
      { key:"trust", label:"Absence of Trust", order:1,
        green:"We're vulnerable with each other — admitting mistakes and weaknesses, and asking for help, without fear.",
        red:"We stay guarded; admitting a weakness feels unsafe, so real trust never quite forms.",
        scoreBands:{ good:8, warn:6 },
        statements:[
          "Team members quickly and genuinely apologize to one another when they say or do something inappropriate or possibly damaging to the team.",
          "Team members openly admit their weaknesses and mistakes.",
          "Team members know about one another's personal lives and are comfortable discussing them."
        ],
        strategies:[ "Identify and discuss individual strengths and weaknesses.", "Spend considerable time in face-to-face meetings and working sessions." ] },
      { key:"conflict", label:"Fear of Conflict", order:2,
        green:"We engage in direct, passionate debate about ideas — disagreement is normal and productive.",
        red:"We avoid friction to keep the peace, so real disagreements stay under the surface (false harmony).",
        scoreBands:{ good:8, warn:6 },
        statements:[
          "Team members are passionate and unguarded in their discussion of issues.",
          "Team meetings are compelling, and not boring.",
          "During team meetings, the most important — and difficult — issues are put on the table to be resolved."
        ],
        strategies:[ "Acknowledge that conflict is required for productive meetings.", "Understand individual team members' natural conflict styles, and establish common ground rules for engaging in conflict." ] },
      { key:"commitment", label:"Lack of Commitment", order:3,
        green:"We leave decisions clear and committed to, even after real debate — “disagree and commit.”",
        red:"Decisions stay vague or half-agreed, so the team re-litigates them later (a sense of ambiguity).",
        scoreBands:{ good:8, warn:6 },
        statements:[
          "Team members know what their peers are working on and how they contribute to the collective good of the team.",
          "Team members leave meetings confident that their peers are completely committed to the decisions that were agreed on, even if there was initial disagreement.",
          "Team members end discussions with clear and specific resolutions and calls to action."
        ],
        strategies:[ "Review commitments at the end of each meeting to ensure all team members are aligned.", "Adopt a “disagree and commit” mentality — make sure all team members are committed regardless of initial disagreements." ] },
      { key:"accountability", label:"Avoidance of Accountability", order:4,
        green:"We hold each other accountable directly, even when it's uncomfortable.",
        red:"We tolerate low standards rather than call each other out.",
        scoreBands:{ good:8, warn:6 },
        statements:[
          "Team members call out one another's deficiencies or unproductive behaviors.",
          "Team members are deeply concerned about the prospect of letting down their peers.",
          "Team members challenge one another about their plans and approaches."
        ],
        strategies:[ "Explicitly communicate goals and standards of behavior.", "Regularly discuss performance versus goals and standards." ] },
      { key:"results", label:"Inattention to Results", order:5,
        green:"We stay focused on the team's collective results over individual status or ego.",
        red:"Individual goals or ego quietly take priority over the team's shared results.",
        scoreBands:{ good:8, warn:6 },
        statements:[
          "Team members willingly make sacrifices (such as budget, turf, head count) in their departments or areas of expertise for the good of the team.",
          "Morale is significantly affected by the failure to achieve team goals.",
          "Team members are slow to seek credit for their own contributions, but quick to point out those of others."
        ],
        strategies:[ "Keep the team focused on tangible group goals.", "Reward individuals based on team goals and collective success." ] }
    ]
  };

  // Tuckman's stages of group development (forming/storming/norming/
  // performing/adjourning), via a common 20-statement team-assessment
  // adaptation (4 statements per stage, summed 4-12, same 1/2/3 Rarely/
  // Sometimes/Usually scale as the Five Dysfunctions assessment). Unlike the
  // Five Dysfunctions template, a high score here isn't "healthy" or
  // "unhealthy" in itself -- it just means that stage is CURRENTLY
  // PROMINENT (the source material's own interpretation: 10-12 = prominent,
  // 8-9 = emerging/transitioning, 4-7 = not characteristic right now). We
  // reuse the app's existing good/warn/crit band mechanism to carry exactly
  // that reading (green = "prominent," not "good news") rather than
  // reinterpreting Tuckman as if one stage were objectively better than
  // another -- the green/red anchor text on each dimension spells this out.
  var TUCKMAN_TEMPLATE = {
    id: "starter-tuckman",
    starter: true,
    name: "Tuckman's Team Development Stages",
    unit: "Squad", unitPlural: "Squads",
    attribution: "Adapted from Bruce Tuckman's stages of group development (forming, storming, norming, performing, adjourning). The 10–12 / 8–9 / 4–7 scoring bands are from the source assessment; consolidating multiple teammates’ answers into one board rating, and the facilitator override, are Dr. Agile’s own.",
    dimensions: [
      { key:"forming", label:"Forming", order:1,
        green:"This stage is prominent right now — the team is still getting oriented, goals may be unclear, and members lean on the leader for direction.",
        red:"Forming isn't strongly showing up right now — the team may already be past early orientation, or still settling into it.",
        scoreBands:{ good:10, warn:8 },
        statements:[
          "Team members are still learning about each other's roles, expertise, and how they fit into the team.",
          "There is uncertainty about the team's goals, priorities, or how to proceed with our work.",
          "Team members look to the leader to provide direction and clarify expectations.",
          "Our team interactions feel polite and cautious, with members being careful about what they say."
        ],
        strategies:[ "Invest time in team-building and getting to know one another.", "Clearly communicate goals, roles, and expectations.", "Provide strong initial leadership and structure.", "Create space for questions and clarification." ] },
      { key:"storming", label:"Storming", order:2,
        green:"This stage is prominent right now — disagreements are surfacing, some resistance to the task is visible, and tension or personal agendas are showing up.",
        red:"Storming isn't strongly showing up right now — conflict and resistance aren't dominating right now.",
        scoreBands:{ good:10, warn:8 },
        statements:[
          "Disagreements or conflicts surface during team meetings or discussions.",
          "Some team members seem to resist the task at hand or question proposed approaches.",
          "Cliques, subgroups, or personal agendas are emerging within the team.",
          "Tension or emotional reactions are noticeable when decisions are made or direction is set."
        ],
        strategies:[ "Surface disagreements and address them directly.", "Establish ground rules for productive conflict.", "Help team members understand diverse perspectives.", "Reaffirm team goals and shared purpose." ] },
      { key:"norming", label:"Norming", order:3,
        green:"This stage is prominent right now — the team has agreed on shared norms, roles are clear, and mutual support is developing.",
        red:"Norming isn't strongly showing up right now — shared norms and role clarity may still be taking hold.",
        scoreBands:{ good:10, warn:8 },
        statements:[
          "The team has agreed on shared standards, norms, or ways of working together.",
          "Team members understand their roles and responsibilities clearly.",
          "We are able to give and receive feedback constructively without fear.",
          "There is a sense of unity and mutual support among team members."
        ],
        strategies:[ "Reinforce agreed-upon norms and working standards.", "Recognize and celebrate alignment and cooperation.", "Encourage peer feedback and mutual accountability.", "Build on emerging trust and cohesion." ] },
      { key:"performing", label:"Performing", order:4,
        green:"This stage is prominent right now — the team operates flexibly and interdependently, with energy focused on results and strong productivity.",
        red:"Performing isn't strongly showing up right now — the team isn't operating with this level of flexibility and results focus.",
        scoreBands:{ good:10, warn:8 },
        statements:[
          "Our team operates flexibly, with roles and responsibilities shifting as needed.",
          "We focus our energy on solving problems and achieving team goals.",
          "The team produces high-quality results and maintains strong productivity.",
          "Team members take ownership and work interdependently with minimal supervision."
        ],
        strategies:[ "Delegate decision-making and empower autonomy.", "Focus on continuous improvement and learning.", "Celebrate results and shared successes.", "Maintain psychological safety and trust." ] },
      { key:"adjourning", label:"Adjourning", order:5,
        green:"This stage is prominent right now — the team is reflecting on what it accomplished and learned, and acknowledging each other's contributions as things wind down or change.",
        red:"Adjourning isn't strongly showing up right now — the team isn't in a winding-down or transition moment.",
        scoreBands:{ good:10, warn:8 },
        statements:[
          "The team reflects on accomplishments and what we've learned together.",
          "There is acknowledgment of individual contributions and the value each member brought.",
          "Team members express mixed emotions about the team ending or changing.",
          "We are taking time to celebrate successes and plan for what comes next."
        ],
        strategies:[ "Conduct retrospectives and harvest lessons learned.", "Acknowledge individual and collective contributions.", "Recognize emotions and the value of relationships.", "Plan intentional closures and transitions." ] }
    ]
  };

  var STARTER_TEMPLATES = [ FIVE_DYSFUNCTIONS_TEMPLATE, TUCKMAN_TEMPLATE ];
  function findAnyTemplateById(id){
    var starter = STARTER_TEMPLATES.find(function(t){ return t.id===id; });
    if(starter) return starter;
    return state.templates.find(function(t){ return t.id===id; });
  }

  // ids match the doc ids the artifact is seeded with (squad-1..squad-7), so a
  // click that happens before the live snapshot arrives still resolves once it does
  var PLACEHOLDER_SQUADS = [1,2,3,4,5,6,7].map(function(n){
    return { id:"squad-"+n, name:"Squad "+n, order:n, dimensions:{} };
  });

  var state = {
    squads: PLACEHOLDER_SQUADS,
    dimensions: PLACEHOLDER_DIMENSIONS,
    templates: [],
    sessions: [],
    config: Object.assign({}, DEFAULT_CONFIG),
    live:false, db:null, editing:null,
    confirmAction:null,
    // per-viewer UI state -- which of the three views is showing, and (for
    // Squad view) which squad this browser is currently acting as. This is
    // NOT synced through the shared db: it's local to this browser only, so
    // remembering it via localStorage is just a convenience (each device
    // tends to be used by/for the same squad) and never grants or restricts
    // access to anything -- the underlying data stays fully shared/visible.
    ui: { view:"tribe", selectedSquadId:null },
    // set when this page was opened via a retro session's join link
    // (?session=<id>) -- a device in this mode shows only the join screen,
    // never the Tribe/Squad/Admin switcher, regardless of ui.view above
    joinSessionId: null,
    joinSession: null,
    // this device's in-progress/completed answers for the *current* session --
    // never synced anywhere except the anonymous submission itself; purely
    // local so this one browser knows what it's already answered/is drafting
    joinDraftAnswers: {},
    joinSubmittedResults: {},  // dimension key -> { sum, band } once submitted
    // facilitator-side: live tally of anonymous submissions for whichever
    // session is currently shown in Squad view (see subscribeSessionResponses)
    sessionResponses: []
  };
  state.joinSessionId = getQueryParam("session");
  (function loadUiPrefs(){
    try{
      var v = localStorage.getItem("squadpulse:view");
      var s = localStorage.getItem("squadpulse:squad");
      if(v==="tribe" || v==="squad" || v==="admin") state.ui.view = v;
      if(s) state.ui.selectedSquadId = s;
    }catch(e){ /* localStorage unavailable -- fall back to defaults */ }
  })();

  // ---------- helpers ----------
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function nowIso(){ return new Date().toISOString(); }
  function getQueryParam(name){
    try{ return new URLSearchParams(window.location.search).get(name); }catch(e){ return null; }
  }
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

  // ---------- rendering ----------
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
        var colorWord = color==="good"?"Green":color==="warn"?"Yellow":color==="crit"?"Red":"Not yet scored";
        var showTrend = trend==="up" || trend==="down";
        var trendWord = trend==="up" ? ", improving" : trend==="down" ? ", declining" : "";
        return '<td>' +
          '<div class="cell-btn '+color+'" role="img" data-squad="'+esc(sq.id)+'" data-dim="'+esc(d.key)+'" ' +
          'aria-label="'+esc(sq.name)+' &middot; '+esc(d.label)+': '+colorWord+trendWord+'">' +
            markIcon(color) +
            (showTrend ? '<span class="trend-badge '+trend+'" title="'+(trend==="up"?"Improving":"Declining")+'">'+trendIcon(trend)+'</span>' : '') +
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

  // ---------- busy overlay ----------
  var busyOverlayEl = document.getElementById("busyOverlay");
  var busyTextEl = document.getElementById("busyText");
  function showBusy(text){ busyTextEl.textContent = text || "Working…"; busyOverlayEl.hidden = false; }
  function hideBusy(){ busyOverlayEl.hidden = true; }

  function findSquad(id){
    for(var i=0;i<state.squads.length;i++){ if(state.squads[i].id===id) return state.squads[i]; }
    return null;
  }

  // ---------- generic confirm modal ----------
  var confirmBackdrop = document.getElementById("confirmBackdrop");
  function openConfirm(title, message, onConfirm, okLabel){
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    document.getElementById("confirmOk").textContent = okLabel || "Confirm";
    state.confirmAction = onConfirm;
    confirmBackdrop.hidden = false;
  }
  function closeConfirm(){ confirmBackdrop.hidden = true; state.confirmAction = null; }
  document.getElementById("confirmCancel").addEventListener("click", closeConfirm);
  document.getElementById("confirmOk").addEventListener("click", function(){
    var action = state.confirmAction;
    closeConfirm();
    if(action) action();
  });
  confirmBackdrop.addEventListener("click", function(e){ if(e.target===confirmBackdrop) closeConfirm(); });

  // ---------- cell rating modal ----------
  var backdrop = document.getElementById("backdrop");
  var modal = document.getElementById("modal");

  function openEditor(squadId, dimKey){
    var sq = findSquad(squadId);
    var d = dimByKey(dimKey);
    diag("open cell squad=" + squadId + " dim=" + dimKey + " -> squad " + (sq ? "FOUND (" + sq.name + ")" : "NOT FOUND"));
    if(!sq || !d) return;
    var cell = (sq.dimensions && sq.dimensions[dimKey]) || {};
    state.editing = { squadId:squadId, dimKey:dimKey, color: cell.color||"unscored", trend: cell.trend||"flat", note: cell.note||"" };

    document.getElementById("modalTitle").textContent = d.label;
    document.getElementById("modalSquadline").textContent = sq.name;
    document.getElementById("modalGreen").textContent = d.green;
    document.getElementById("modalRed").textContent = d.red;
    var noteBox = document.getElementById("modalNote");
    noteBox.value = state.editing.note;
    noteBox.placeholder = "Why this rating? What's driving it?";
    document.getElementById("modalResetOverride").hidden = true;
    updateSwatchSelection();
    updateTrendSelection();
    backdrop.hidden = false;
    noteBox.focus({preventScroll:true});
  }

  function updateSwatchSelection(){
    document.querySelectorAll("#swatches .swatch").forEach(function(sw){
      sw.classList.toggle("selected", sw.getAttribute("data-color")===state.editing.color);
    });
  }
  function updateTrendSelection(){
    document.querySelectorAll("#trendsel button").forEach(function(b){
      b.classList.toggle("selected", b.getAttribute("data-trend")===state.editing.trend);
    });
  }

  document.querySelectorAll("#swatches .swatch").forEach(function(sw){
    sw.addEventListener("click", function(){
      state.editing.color = sw.getAttribute("data-color");
      updateSwatchSelection();
    });
  });
  document.querySelectorAll("#trendsel button").forEach(function(b){
    b.addEventListener("click", function(){
      state.editing.trend = b.getAttribute("data-trend");
      updateTrendSelection();
    });
  });

  function closeModal(){ backdrop.hidden = true; state.editing = null; }
  document.getElementById("modalCancel").addEventListener("click", closeModal);
  backdrop.addEventListener("click", function(e){ if(e.target===backdrop) closeModal(); });
  document.addEventListener("keydown", function(e){
    if(e.key!=="Escape") return;
    if(!backdrop.hidden) closeModal();
    if(!dimBackdrop.hidden) closeDimManager();
    if(!templatesBackdrop.hidden) closeTemplates();
    if(!importBackdrop.hidden) closeImport();
    if(!confirmBackdrop.hidden) closeConfirm();
    if(!document.getElementById("joinCodeBackdrop").hidden) closeJoinCodeModal();
  });

  document.getElementById("modalSave").addEventListener("click", function(){
    try{
      diag("Save clicked; state.editing=" + (state.editing ? JSON.stringify(state.editing) : "null"));
      if(!state.editing) { diag("Save aborted: no state.editing (dialog opened without a valid cell?)"); return; }
      var ed = state.editing;
      ed.note = document.getElementById("modalNote").value.trim();
      if(ed.mode === "session"){
        setSessionOverride(ed.sessionId, ed.dimKey, { color: ed.color, trend: ed.trend, note: ed.note });
        diag("Session override set: " + ed.sessionId + " / " + ed.dimKey + " = " + ed.color);
        renderSquadView();
        return;
      }
      var sq = findSquad(ed.squadId);
      if(sq){
        // shallow-clone in case the current dimensions map is a frozen
        // reference (e.g. straight from a live snapshot) -- never mutate it in place
        sq.dimensions = Object.assign({}, sq.dimensions);
        sq.dimensions[ed.dimKey] = { color: ed.color, trend: ed.trend, note: ed.note };
        diag("Local state updated: " + sq.name + " / " + ed.dimKey + " = " + ed.color + ". Re-rendering + persisting...");
        persistDimensionRating(sq, ed.dimKey);
        renderAll();
      } else {
        diag("Save FAILED: squad id '" + ed.squadId + "' not found in current state.squads (" + state.squads.map(function(s){return s.id;}).join(",") + ")");
      }
    } catch(err){
      diag("Save threw an exception: " + (err && err.message ? err.message : String(err)));
    } finally {
      closeModal();
    }
  });

  document.getElementById("modalResetOverride").addEventListener("click", function(){
    if(!state.editing || state.editing.mode!=="session") return;
    clearSessionOverride(state.editing.sessionId, state.editing.dimKey);
    closeModal();
    renderSquadView();
  });

  // ---------- squad CRUD ----------
  function renameSquad(id, name){
    var sq = findSquad(id);
    if(!sq) return;
    sq.name = name;
    renderAll();
    if(state.live && state.db){
      state.db.collection("squads").doc(id).update({ name:name, updatedAt: nowIso() }).catch(function(){});
    }
  }

  function removeSquad(id){
    state.squads = state.squads.filter(function(s){ return s.id!==id; });
    renderAll();
    if(state.live && state.db){
      state.db.collection("squads").doc(id).delete().catch(function(){});
    }
  }

  function addSquad(){
    var maxOrder = state.squads.reduce(function(m,s){ return Math.max(m, s.order||0); }, 0);
    var name = "New " + unitLower();
    if(state.live && state.db){
      // don't also push a local copy here -- the live squads listener below
      // delivers this same write back immediately (latency-compensated) and
      // fully replaces state.squads, so pushing too would show a duplicate row
      state.db.collection("squads").add({ name:name, order:maxOrder+1, dimensions:{}, updatedAt: nowIso() })
        .catch(function(err){ diag("Add squad failed: " + (err && err.code ? err.code : String(err))); });
    } else {
      state.squads.push({ id:"local-"+Date.now(), name:name, order:maxOrder+1, dimensions:{} });
      renderAll();
    }
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
      var colorWord = color==="good"?"Green":color==="warn"?"Yellow":color==="crit"?"Red":"Not yet scored";
      var showTrend = trend==="up" || trend==="down";
      var trendWord = trend==="up" ? ", improving" : trend==="down" ? ", declining" : "";
      return '<div class="entry-row">' +
        '<div class="entry-info">' +
          '<div class="entry-label" dir="auto">'+esc(d.label)+'</div>' +
          '<div class="entry-desc" dir="auto"><span class="tip-dot good"></span><span>'+esc(d.green||"")+'</span></div>' +
          '<div class="entry-desc" dir="auto"><span class="tip-dot crit"></span><span>'+esc(d.red||"")+'</span></div>' +
        '</div>' +
        '<button class="cell-btn '+color+'" data-squad="'+esc(sq.id)+'" data-dim="'+esc(d.key)+'" type="button" ' +
          'aria-label="'+esc(d.label)+': '+colorWord+trendWord+'">' +
          markIcon(color) +
          (showTrend ? '<span class="trend-badge '+trend+'" title="'+(trend==="up"?"Improving":"Declining")+'">'+trendIcon(trend)+'</span>' : '') +
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

  // ---------- retro sessions (live, facilitated) ----------
  // A session is a lightweight live event scoped to one squad: the SM starts
  // one (snapshotting the board's CURRENT dimensions, so later template
  // changes don't retroactively alter a session already in progress), shares
  // the join link/QR, and closes it when done. Closing just ends the
  // session (deletes the doc) -- there's no history feature yet, matching
  // the "current snapshot only" decision made for the rest of the board, so
  // nothing is archived. Submitting individual answers and consolidating
  // them into the squad's rating comes in a later change; for now a session
  // existing or not existing doesn't touch squad.dimensions at all.
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
      if(d.statements && d.statements.length) spec.statements = d.statements;
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
    if(state.live && state.db){
      state.db.collection("sessions").doc(code).set(payload).then(function(){
        diag("Started retro session " + code + " for squad " + sq.id);
      }).catch(function(err){ diag("Start session failed: " + (err && err.code ? err.code : String(err))); });
    } else {
      state.sessions.push(Object.assign({ id:code }, payload));
      renderSquadView();
    }
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
    if(state.live && state.db){
      state.db.collection("sessions").doc(sessionId).delete().catch(function(err){
        diag("Close session failed: " + (err && err.code ? err.code : String(err)));
      });
    } else {
      state.sessions = state.sessions.filter(function(s){ return s.id!==sessionId; });
      renderSquadView();
    }
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
            ? '<span class="dim-trend '+result.trend+'" title="'+(result.trend==="up"?"Improving":"Declining")+'">'+trendIcon(result.trend)+'</span>' : '';
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

  function bindSessionCardEvents(sq){
    var startBtn = document.getElementById("startSessionBtn");
    if(startBtn) startBtn.addEventListener("click", function(){ startSession(sq); });

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
        var word = x.result.color==="good"?"Green":x.result.color==="warn"?"Yellow":"Red";
        return x.dim.label + ": " + word + (x.result.overridden ? " (overridden)" : "");
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
    if(state.live && state.db){
      state.db.collection("sessions").doc(sess.id).update({ revealMode: mode }).catch(function(err){
        diag("Set reveal mode failed: " + (err && err.code ? err.code : String(err)));
      });
    } else {
      sess.revealMode = mode;
      renderSquadView();
    }
  }

  // ---------- facilitator override + sprint note (Story 7-8) ----------
  // An override lives on the session doc itself (sessions/{id}.overrides.{dimKey}),
  // not on the squad -- it only takes effect on the squad's real rating once
  // the SM finishes the retro (Story 9). null/absent means "use whatever the
  // live majority/calmer-tie consolidation says."
  function setSessionOverride(sessionId, dimKey, val){
    if(state.live && state.db){
      var patch = { overrides:{} };
      patch.overrides[dimKey] = val;
      state.db.collection("sessions").doc(sessionId).update(patch).catch(function(err){
        diag("Set override failed: " + (err && err.code ? err.code : String(err)));
      });
    } else {
      var sess = state.sessions.filter(function(s){ return s.id===sessionId; })[0];
      if(sess){
        sess.overrides = Object.assign({}, sess.overrides);
        sess.overrides[dimKey] = val;
      }
    }
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
    if(state.live && state.db){
      state.db.collection("sessions").doc(sessionId).update({ experimentNote: text }).catch(function(err){
        diag("Save experiment note failed: " + (err && err.code ? err.code : String(err)));
      });
    } else {
      var sess = state.sessions.filter(function(s){ return s.id===sessionId; })[0];
      if(sess) sess.experimentNote = text;
    }
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
  // A doc-level onSnapshot on the session itself (see listenJoinSession)
  // wouldn't see these -- responses live in their own subcollection so that
  // submitting an answer never touches, and can't race, the session doc.
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

  // ---------- join screen (participant device) ----------
  // Reached either by opening ?session=<id> directly, or -- the reliable
  // path, since some phones' camera-to-app handoff doesn't carry a query
  // string through -- by typing the session code into the "Join a retro"
  // button in the header. Either way, once in join mode the device never
  // sees the Tribe/Squad/Admin switcher -- only this one screen, which just
  // watches that one session doc and reflects its current state. No
  // submission yet: that arrives once the statement-based entry flow exists.
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
    if(!sess || sess.status !== "open"){
      el.innerHTML =
        '<h2>This retro session isn&rsquo;t open</h2>' +
        '<p class="hint">Check the link with whoever is running the retro &mdash; it may have already ended, or the link may be out of date.</p>';
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
      if(state.live && state.db){
        state.db.collection("sessions").doc(state.joinSessionId).collection("responses").add(payload)
          .then(afterSubmit)
          .catch(function(err){
            diag("Submit answer failed: " + (err && err.code ? err.code : String(err)));
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit";
          });
      } else {
        afterSubmit();
      }
    });
  }

  function listenJoinSession(){
    state.db.doc("sessions/" + state.joinSessionId).onSnapshot(function(snap){
      state.joinSession = snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
      diag("Join session snapshot: " + (state.joinSession ? state.joinSession.status : "not found"));
      renderJoinScreen();
    }, function(err){
      diag("Join session listener error: " + (err && err.code ? err.code : String(err)));
      state.joinSession = null;
      renderJoinScreen();
    });
  }

  // ---------- view switch (Tribe / Squad / Admin) ----------
  // Purely a per-viewer UI convenience -- everyone shares the same underlying
  // data regardless of which view they're looking at; this only decides which
  // screen renders it, and for whom, right now. It is not access control.
  function applyViewVisibility(){
    document.querySelectorAll(".view-btn").forEach(function(b){
      b.classList.toggle("active", b.getAttribute("data-view")===state.ui.view);
    });
    document.getElementById("viewTribe").hidden = state.ui.view!=="tribe";
    document.getElementById("viewSquad").hidden = state.ui.view!=="squad";
    document.getElementById("viewAdmin").hidden = state.ui.view!=="admin";
  }
  function setView(view){
    state.ui.view = view;
    try{ localStorage.setItem("squadpulse:view", view); }catch(e){ /* per-viewer convenience only */ }
    applyViewVisibility();
  }
  document.querySelectorAll(".view-btn").forEach(function(b){
    b.addEventListener("click", function(){ setView(b.getAttribute("data-view")); });
  });

  function persistDimensionRating(sq, dimKey){
    if(!(state.live && state.db)) { diag("Persist skipped: not connected to live storage (state.live=" + state.live + ")"); return; }
    try{
      var patch = { dimensions:{}, updatedAt: nowIso() };
      patch.dimensions[dimKey] = sq.dimensions[dimKey];
      diag("Writing squads/" + sq.id + " ...");
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

  // Same as persistDimensionRating, but writes several dimensions of one
  // squad in a single update -- used when finishing a retro (Story 9), so
  // all 5 (or however many) consolidated results land together.
  function persistDimensionRatings(sq, dimKeys){
    if(!(state.live && state.db)) { diag("Persist skipped (batch): not connected to live storage (state.live=" + state.live + ")"); return; }
    try{
      var patch = { dimensions:{}, updatedAt: nowIso() };
      dimKeys.forEach(function(k){ patch.dimensions[k] = sq.dimensions[k]; });
      diag("Writing squads/" + sq.id + " (batch, " + dimKeys.length + " dim(s))...");
      state.db.collection("squads").doc(sq.id).update(patch).then(function(){
        diag("Batch write CONFIRMED for squads/" + sq.id);
      }).catch(function(err){
        diag("Batch write REJECTED for squads/" + sq.id + ": " + (err && err.code ? err.code : String(err)) + (err && err.message ? " - " + err.message : ""));
        if(err && err.code==="invalid_argument"){
          state.db.collection("squads").doc(sq.id).set(Object.assign({name:sq.name, order:sq.order||0}, {dimensions:sq.dimensions}))
            .then(function(){ diag("Fallback set() succeeded for squads/" + sq.id); })
            .catch(function(err2){ diag("Fallback set() ALSO failed for squads/" + sq.id + ": " + (err2 && err2.code ? err2.code : String(err2))); });
        }
      });
    } catch(err){
      diag("Persist (batch) threw synchronously: " + (err && err.message ? err.message : String(err)));
    }
  }

  // ---------- dimension manager ----------
  var dimBackdrop = document.getElementById("dimBackdrop");

  function openDimManager(){
    renderDimList();
    dimBackdrop.hidden = false;
  }
  function closeDimManager(){ dimBackdrop.hidden = true; }
  document.getElementById("dimManageBtn").addEventListener("click", openDimManager);
  document.getElementById("dimDoneBtn").addEventListener("click", closeDimManager);
  dimBackdrop.addEventListener("click", function(e){ if(e.target===dimBackdrop) closeDimManager(); });

  function renderDimList(){
    var dims = sortedDimensions();
    var html = dims.map(function(d, i){
      return '<div class="dim-row" data-key="'+esc(d.key)+'">' +
        '<div class="dim-row-top">' +
          '<button class="icon-btn dim-up" title="Move up" type="button" '+(i===0?"disabled":"")+'>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 15l7-7 7 7"/></svg></button>' +
          '<button class="icon-btn dim-down" title="Move down" type="button" '+(i===dims.length-1?"disabled":"")+'>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 9l7 7 7-7"/></svg></button>' +
          '<input class="dim-label" data-field="label" value="'+esc(d.label)+'" aria-label="Dimension name" placeholder="Dimension name" dir="auto">' +
          '<button class="icon-btn danger dim-del" title="Remove dimension" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</div>' +
        '<div class="fields">' +
          '<div><label class="grn">Green looks like</label><textarea data-field="green" placeholder="What healthy looks like" dir="auto">'+esc(d.green)+'</textarea></div>' +
          '<div><label class="rd">Red looks like</label><textarea data-field="red" placeholder="What unhealthy looks like" dir="auto">'+esc(d.red)+'</textarea></div>' +
        '</div>' +
        (d.statements && d.statements.length ?
          '<p class="hint" style="margin:8px 0 0;">Scored from '+d.statements.length+' self-assessment statements (not editable here yet) — rating this dimension still uses the swatches above until the statement-based entry flow ships.</p>' : "") +
      '</div>';
    }).join("");
    document.getElementById("dimList").innerHTML = html || '<p class="hint" style="margin:0;">No dimensions yet — add your first one below.</p>';
    bindDimListEvents();
  }

  function bindDimListEvents(){
    document.querySelectorAll("#dimList .dim-row").forEach(function(row){
      var key = row.getAttribute("data-key");
      row.querySelectorAll("[data-field]").forEach(function(field){
        field.addEventListener("change", function(){
          updateDimensionField(key, field.getAttribute("data-field"), field.value);
        });
      });
      var upBtn = row.querySelector(".dim-up");
      var downBtn = row.querySelector(".dim-down");
      if(upBtn) upBtn.addEventListener("click", function(){ moveDimension(key, -1); });
      if(downBtn) downBtn.addEventListener("click", function(){ moveDimension(key, 1); });
      var delBtn = row.querySelector(".dim-del");
      if(delBtn) delBtn.addEventListener("click", function(){
        var d = dimByKey(key);
        openConfirm(
          "Remove dimension?",
          "Remove “" + (d ? d.label : "this dimension") + "” from the grid? Any ratings already given for it will be hidden (not deleted) unless you add it back.",
          function(){ removeDimension(key); },
          "Remove"
        );
      });
    });
  }

  function updateDimensionField(key, field, value){
    var d = dimByKey(key);
    if(!d) return;
    d[field] = value;
    renderAll();
    renderDimList();
    if(state.live && state.db){
      var patch = {}; patch[field] = value; patch.updatedAt = nowIso();
      state.db.collection("dimensions").doc(key).update(patch).catch(function(err){
        diag("Dimension field update failed for " + key + ": " + (err && err.code ? err.code : String(err)));
      });
    }
  }

  function moveDimension(key, delta){
    var dims = sortedDimensions();
    var idx = dims.findIndex(function(d){ return d.key===key; });
    var swapIdx = idx + delta;
    if(idx<0 || swapIdx<0 || swapIdx>=dims.length) return;
    var a = dims[idx], b = dims[swapIdx];
    var tmp = a.order; a.order = b.order; b.order = tmp;
    renderAll();
    renderDimList();
    if(state.live && state.db){
      state.db.collection("dimensions").doc(a.key).update({ order:a.order, updatedAt: nowIso() }).catch(function(){});
      state.db.collection("dimensions").doc(b.key).update({ order:b.order, updatedAt: nowIso() }).catch(function(){});
    }
  }

  function addDimension(){
    var maxOrder = state.dimensions.reduce(function(m,d){ return Math.max(m, d.order||0); }, 0);
    var payload = { label:"New dimension", green:"", red:"", order:maxOrder+1, updatedAt: nowIso() };
    if(state.live && state.db){
      // no local push -- the live dimensions listener delivers this write
      // straight back (latency-compensated) and fully replaces state.dimensions
      state.db.collection("dimensions").add(payload)
        .catch(function(err){ diag("Add dimension failed: " + (err && err.code ? err.code : String(err))); });
    } else {
      state.dimensions.push({ key:"local-dim-"+Date.now(), label:payload.label, green:"", red:"", order:payload.order });
      renderAll();
      renderDimList();
    }
  }
  document.getElementById("addDimBtn").addEventListener("click", addDimension);

  function removeDimension(key){
    state.dimensions = state.dimensions.filter(function(d){ return d.key!==key; });
    renderAll();
    renderDimList();
    if(state.live && state.db){
      state.db.collection("dimensions").doc(key).delete().catch(function(){});
    }
  }

  // ---------- templates ----------
  var templatesBackdrop = document.getElementById("templatesBackdrop");

  function openTemplates(){
    renderTemplateList();
    templatesBackdrop.hidden = false;
  }
  function closeTemplates(){ templatesBackdrop.hidden = true; }
  document.getElementById("templatesBtn").addEventListener("click", openTemplates);
  document.getElementById("tplCloseBtn").addEventListener("click", closeTemplates);
  templatesBackdrop.addEventListener("click", function(e){ if(e.target===templatesBackdrop) closeTemplates(); });

  function templateRowHtml(t, opts){
    var scoredCount = (t.dimensions||[]).filter(function(d){ return d.statements && d.statements.length; }).length;
    var meta = t.dimensions.length+' dimension'+(t.dimensions.length===1?"":"s")+(t.unit?(' &middot; rates '+esc(t.unitPlural||t.unit)):"") +
      (scoredCount ? (' &middot; '+scoredCount+' scored from statements') : "");
    return '<div class="tpl-row" data-id="'+esc(t.id)+'">' +
      '<div class="tinfo">' +
        '<div class="tname" dir="auto">'+esc(t.name)+'</div>' +
        '<div class="tmeta">'+meta+'</div>' +
      '</div>' +
      '<button class="btn" data-action="load" type="button">Load</button>' +
      (opts && opts.deletable === false ? "" :
        '<button class="icon-btn danger" data-action="delete" title="Delete template" type="button">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7"/></svg></button>') +
    '</div>';
  }

  function renderTemplateList(){
    var starterHtml = STARTER_TEMPLATES.map(function(t){ return templateRowHtml(t, { deletable:false }); }).join("");
    var ownHtml = state.templates.map(function(t){ return templateRowHtml(t); }).join("");
    var html =
      '<div class="field-label" style="margin-top:0;">Starter templates</div>' +
      starterHtml +
      '<div class="field-label">Your templates</div>' +
      (ownHtml || '<p class="hint" style="margin:0;">No saved templates yet — set up your dimensions the way you want, then “Save current as template” below.</p>');
    document.getElementById("tplList").innerHTML = html;
    document.querySelectorAll("#tplList .tpl-row").forEach(function(row){
      var id = row.getAttribute("data-id");
      var t = findAnyTemplateById(id);
      if(!t) return;
      row.querySelector('[data-action="load"]').addEventListener("click", function(){
        openConfirm(
          "Load “" + t.name + "”?",
          "This replaces your current " + state.dimensions.length + " dimension(s) with " + t.name + "’s " + t.dimensions.length + ". Ratings tied to dimensions that don't carry over will be hidden, not deleted.",
          function(){ loadTemplate(t); },
          "Load template"
        );
      });
      var delBtn = row.querySelector('[data-action="delete"]');
      if(delBtn) delBtn.addEventListener("click", function(){
        openConfirm(
          "Delete “" + t.name + "”?",
          "This removes the saved template. It won't affect your current dimensions or ratings.",
          function(){ deleteTemplate(t.id); },
          "Delete"
        );
      });
    });
  }

  document.getElementById("tplSaveBtn").addEventListener("click", function(){
    var input = document.getElementById("tplNameInput");
    var name = input.value.trim();
    if(!name){ input.focus(); return; }
    saveCurrentAsTemplate(name);
    input.value = "";
  });

  function saveCurrentAsTemplate(name){
    // carry each dimension's live key along -- loading this template back later
    // reuses the same dimension ids, so ratings already given reconnect instead
    // of the load creating fresh (and therefore rating-less) dimensions
    var dims = sortedDimensions().map(function(d){
      var spec = { key:d.key, label:d.label, green:d.green, red:d.red, order:d.order };
      if(d.statements && d.statements.length) spec.statements = d.statements;
      if(d.scoreBands) spec.scoreBands = d.scoreBands;
      if(d.strategies && d.strategies.length) spec.strategies = d.strategies;
      return spec;
    });
    var payload = {
      name:name, unit:state.config.unit, unitPlural:state.config.unitPlural,
      attribution:"", dimensions:dims, createdAt: nowIso()
    };
    if(state.live && state.db){
      // no local push -- the live templates listener delivers this write
      // straight back (latency-compensated) and fully replaces state.templates
      state.db.collection("templates").add(payload).then(function(){
        diag("Saved template '" + name + "'.");
      }).catch(function(err){ diag("Save template failed: " + (err && err.code ? err.code : String(err))); });
    } else {
      state.templates.push(Object.assign({ id:"local-tpl-"+Date.now() }, payload));
      renderTemplateList();
    }
  }

  function deleteTemplate(id){
    state.templates = state.templates.filter(function(t){ return t.id!==id; });
    renderTemplateList();
    if(state.live && state.db){
      state.db.collection("templates").doc(id).delete().catch(function(){});
    }
  }

  function loadTemplate(t){
    var newConfig = {
      unit: t.unit || state.config.unit,
      unitPlural: t.unitPlural || state.config.unitPlural,
      activeTemplateName: t.name,
      attribution: t.attribution || ""
    };
    // reuse each dimension's saved key (falling back to a template-namespaced
    // slug of its label for templates saved before keys were tracked) --
    // loading the SAME template again later re-creates the SAME dimension
    // ids, so any ratings given while it was active are still there
    var newDimSpecs = t.dimensions.map(function(d, i){
      var key = d.key || slugify(t.id + "-" + d.label, t.id + "-dim-" + (i+1));
      var spec = { key:key, label:d.label, green:d.green||"", red:d.red||"", order:d.order||(i+1) };
      if(d.statements && d.statements.length) spec.statements = d.statements;
      if(d.scoreBands) spec.scoreBands = d.scoreBands;
      if(d.strategies && d.strategies.length) spec.strategies = d.strategies;
      return spec;
    });

    if(state.live && state.db){
      showBusy('Switching to “' + t.name + '”…');
      diag("Loading template '" + t.name + "': removing " + state.dimensions.length + " current dimension(s)...");
      var oldKeys = state.dimensions.map(function(d){ return d.key; });
      var newKeys = {}; newDimSpecs.forEach(function(d){ newKeys[d.key] = true; });
      // only delete old dimensions that the incoming set doesn't reuse --
      // avoids a pointless delete+recreate round-trip when a key carries over
      var toDelete = oldKeys.filter(function(k){ return !newKeys[k]; });
      Promise.all(toDelete.map(function(k){ return state.db.collection("dimensions").doc(k).delete(); }))
        .then(function(){
          diag("Writing " + newDimSpecs.length + " dimension(s) for '" + t.name + "'...");
          return Promise.all(newDimSpecs.map(function(d){
            var payload = { label:d.label, green:d.green, red:d.red, order:d.order, updatedAt: nowIso() };
            // statements/scoreBands/strategies are optional content used by the
            // scored-survey rating flow (not built yet) -- carried through here
            // so a template that has them keeps them once that flow exists
            if(d.statements) payload.statements = d.statements;
            if(d.scoreBands) payload.scoreBands = d.scoreBands;
            if(d.strategies) payload.strategies = d.strategies;
            return state.db.collection("dimensions").doc(d.key).set(payload);
          }));
        })
        .then(function(){
          return state.db.doc("meta/config").set(Object.assign({}, newConfig, { updatedAt: nowIso() }));
        })
        .then(function(){
          diag("Template '" + t.name + "' loaded successfully.");
          hideBusy();
          closeDimManager();
          closeTemplates();
        })
        .catch(function(err){
          hideBusy();
          diag("Load template FAILED: " + (err && err.code ? err.code : String(err)) + (err && err.message ? " - " + err.message : ""));
        });
    } else {
      state.dimensions = newDimSpecs;
      state.config = Object.assign({}, state.config, newConfig);
      renderAll();
      renderDimList();
      closeTemplates();
    }
  }

  // ---------- CSV export ----------
  function toCSV(){
    var dims = sortedDimensions();
    // the Template column records which dimension set was active at export time --
    // without it, a file re-imported after switching templates has no way to
    // flag that its dimension names may no longer mean the same thing.
    // The Dimension Key column records each dimension's STABLE id, so a file
    // can still be re-imported correctly after a dimension is renamed --
    // matching purely by the Dimension (label) text breaks the moment that
    // text changes, e.g. after translating labels to Hebrew.
    var templateName = state.config.activeTemplateName || "Custom";
    var rows = [[state.config.unit, "Dimension", "Health", "Trend", "Note", "Template", "Dimension Key"]];
    sortedSquads().forEach(function(sq){
      dims.forEach(function(d){
        var cell = (sq.dimensions && sq.dimensions[d.key]) || {};
        var color = cell.color==="good"?"Green":cell.color==="warn"?"Yellow":cell.color==="crit"?"Red":"Not scored";
        var trend = cell.trend==="up"?"Improving":cell.trend==="down"?"Declining":cell.trend==="flat"?"Steady":"";
        rows.push([sq.name, d.label, color, trend, cell.note||"", templateName, d.key]);
      });
    });
    return rows.map(function(r){
      return r.map(function(v){
        var s = String(v==null?"":v);
        return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
      }).join(",");
    }).join("\r\n");
  }

  document.getElementById("exportBtn").addEventListener("click", async function(){
    var csv = toCSV();
    try{
      var downloads = await (window.claude && window.claude.use ? window.claude.use("downloads") : Promise.resolve(null));
      if(downloads){
        await downloads.save({ filename:"squad-pulse-snapshot.csv", data: csv });
        return;
      }
    }catch(e){ /* fall through */ }
    // fallback: open a data URL the viewer can save manually (no capability available)
    var w = window.open("", "_blank");
    if(w){ w.document.write("<pre style='white-space:pre-wrap;font-family:monospace;padding:16px;'>"+esc(csv)+"</pre>"); }
  });

  // ---------- CSV import ----------
  var importBackdrop = document.getElementById("importBackdrop");
  var csvFileInput = document.getElementById("csvFileInput");
  var pendingImportPlan = null;

  document.getElementById("importCsvBtn").addEventListener("click", function(){ csvFileInput.click(); });

  csvFileInput.addEventListener("change", function(){
    var file = csvFileInput.files && csvFileInput.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var rows = parseCSV(String(reader.result||""));
        pendingImportPlan = buildImportPlan(rows);
        renderImportPreview(pendingImportPlan);
        document.getElementById("importUnitLabel").textContent = state.config.unit;
        document.getElementById("importUnitLabel2").textContent = state.config.unit;
        importBackdrop.hidden = false;
        diag("CSV parsed: " + rows.length + " row(s), " + pendingImportPlan.ratingCount + " rating(s) matched, " + pendingImportPlan.skipped.length + " skipped.");
      }catch(err){
        diag("CSV import: failed to parse file: " + (err && err.message ? err.message : String(err)));
      }
      csvFileInput.value = ""; // allow re-selecting the same file later
    };
    reader.onerror = function(){ diag("CSV import: could not read the selected file."); csvFileInput.value = ""; };
    reader.readAsText(file);
  });

  function parseCSV(text){
    var rows = [], row = [], field = "", inQuotes = false;
    for(var i=0;i<text.length;i++){
      var c = text[i];
      if(inQuotes){
        if(c === '"'){
          if(text[i+1] === '"'){ field += '"'; i++; } else { inQuotes = false; }
        } else { field += c; }
      } else {
        if(c === '"'){ inQuotes = true; }
        else if(c === ','){ row.push(field); field = ""; }
        else if(c === '\r'){ /* ignore -- \n (below) ends the row */ }
        else if(c === '\n'){ row.push(field); field = ""; rows.push(row); row = []; }
        else { field += c; }
      }
    }
    if(field.length>0 || row.length>0){ row.push(field); rows.push(row); }
    return rows.filter(function(r){ return !(r.length<=1 && (r[0]||"").trim()===""); });
  }

  function colorFromWord(w){
    w = String(w||"").trim().toLowerCase();
    if(w==="green") return "good";
    if(w==="yellow") return "warn";
    if(w==="red") return "crit";
    return "unscored";
  }
  function trendFromWord(w){
    w = String(w||"").trim().toLowerCase();
    if(w==="improving") return "up";
    if(w==="declining") return "down";
    if(w==="steady") return "flat";
    return undefined;
  }

  // Maps the header row to column positions by NAME (case-insensitive), so
  // reordered columns still import correctly. Column 0 is always read as the
  // entity-name column regardless of its header text, since that header is
  // dynamic (it's whatever the unit label is -- "Squad", "Team", "Person"...).
  // If none of the known header names are recognized at all (e.g. every header
  // was renamed, or blanked), falls back to toCSV()'s fixed column order so
  // renaming headers never breaks an import.
  function mapImportColumns(headerRow){
    var idx = { dimension:1, health:2, trend:3, note:4, template:5, dimensionKey:6 };
    var recognized = 0;
    (headerRow||[]).forEach(function(h, i){
      var key = String(h||"").trim().toLowerCase();
      if(key==="dimension"){ idx.dimension = i; recognized++; }
      else if(key==="health"){ idx.health = i; recognized++; }
      else if(key==="trend"){ idx.trend = i; recognized++; }
      else if(key==="note"){ idx.note = i; recognized++; }
      else if(key==="template"){ idx.template = i; recognized++; }
      else if(key==="dimension key" || key==="dimensionkey" || key==="key"){ idx.dimensionKey = i; recognized++; }
    });
    idx.recognized = recognized;
    return idx;
  }

  // Reads the columns toCSV() writes: <unit>, Dimension, Health, Trend, Note,
  // Template (files exported before Template existed still import fine --
  // that column just reads as blank). Matches squads by name (creating ones
  // that don't exist yet) and dimensions by label against the CURRENT
  // dimension set -- a row whose dimension isn't found today is reported, not
  // guessed at. Also surfaces which template the file itself was exported
  // under, so a mismatch against the board's current template can be flagged
  // rather than just silently producing a pile of "not found" rows.
  function buildImportPlan(rows){
    var cols = mapImportColumns(rows[0]);
    var dataRows = rows.slice(1); // first row is always the header, whatever it says
    var dimByKeyMap = {};
    var dimByLabel = {};
    sortedDimensions().forEach(function(d){
      dimByKeyMap[d.key] = d;
      dimByLabel[d.label.trim().toLowerCase()] = d;
    });
    var existingByName = {};
    state.squads.forEach(function(s){ existingByName[s.name.trim().toLowerCase()] = s; });

    var squadPatches = {}, order = [], newSquadNames = [], skipped = [], ratingCount = 0;
    var fileTemplateNames = [], seenTemplateNames = {};

    dataRows.forEach(function(r, idx){
      var squadName = (r[0]||"").trim();
      var dimLabel = (r[cols.dimension]||"").trim();
      var dimKeyVal = (r[cols.dimensionKey]||"").trim();
      var fileTemplate = (r[cols.template]||"").trim();
      if(fileTemplate && !seenTemplateNames[fileTemplate]){ seenTemplateNames[fileTemplate] = true; fileTemplateNames.push(fileTemplate); }
      if(!squadName || (!dimLabel && !dimKeyVal)) return;
      // match by the stable Dimension Key first -- it still resolves correctly
      // after a dimension's label has been renamed or translated (e.g. to
      // Hebrew); fall back to matching by label text for older exports (no
      // Dimension Key column) or hand-edited/foreign files
      var dim = (dimKeyVal && dimByKeyMap[dimKeyVal]) || dimByLabel[dimLabel.toLowerCase()];
      if(!dim){
        skipped.push({ row: idx+2, squad: squadName, dimension: dimLabel || dimKeyVal, reason: "dimension not found" });
        return;
      }
      var nameKey = squadName.toLowerCase();
      if(!squadPatches[nameKey]){
        squadPatches[nameKey] = { name: squadName, existing: existingByName[nameKey] || null, dims: {} };
        order.push(nameKey);
        if(!existingByName[nameKey]) newSquadNames.push(squadName);
      }
      squadPatches[nameKey].dims[dim.key] = { color: colorFromWord(r[cols.health]), trend: trendFromWord(r[cols.trend]), note: (r[cols.note]||"").trim() };
      ratingCount++;
    });

    var patches = order.map(function(k){ return squadPatches[k]; });
    return {
      patches: patches, newSquadNames: newSquadNames, skipped: skipped, ratingCount: ratingCount,
      fileTemplateNames: fileTemplateNames,
      currentTemplateName: state.config.activeTemplateName || "Custom"
    };
  }

  function renderImportPreview(plan){
    var updatedExisting = plan.patches.filter(function(p){ return p.existing; }).length;
    var chips = '<div class="import-stats">' +
      '<span class="chip ok">'+plan.ratingCount+' rating'+(plan.ratingCount===1?"":"s")+' to import</span>' +
      '<span class="chip">'+updatedExisting+' existing '+(updatedExisting===1?unitLower():unitPluralLower())+' updated</span>' +
      (plan.newSquadNames.length ? '<span class="chip">'+plan.newSquadNames.length+' new '+(plan.newSquadNames.length===1?unitLower():unitPluralLower())+': '+plan.newSquadNames.map(esc).join(", ")+'</span>' : '') +
      (plan.skipped.length ? '<span class="chip warn">'+plan.skipped.length+' row'+(plan.skipped.length===1?"":"s")+' skipped</span>' : '') +
    '</div>';

    // flag when the file's own recorded template doesn't match what's
    // active now -- the likeliest reason dimension names would fail to match
    var templateWarning = "";
    if(plan.fileTemplateNames.length > 1){
      templateWarning = '<div class="import-warning">This file mixes rows exported under different templates (' +
        plan.fileTemplateNames.map(esc).join(", ") + '). Ratings may get matched to the wrong dimension if any names overlap by coincidence.</div>';
    } else if(plan.fileTemplateNames.length === 1 && plan.fileTemplateNames[0] !== plan.currentTemplateName){
      templateWarning = '<div class="import-warning">This file was exported under &ldquo;' + esc(plan.fileTemplateNames[0]) +
        '&rdquo;, but the board is currently on &ldquo;' + esc(plan.currentTemplateName) +
        '&rdquo;. Dimension names may not line up &mdash; that’s the most likely reason for any rows skipped below. Switch back to that template first if you want every row to match.</div>';
    } else if(plan.fileTemplateNames.length === 0){
      templateWarning = '<div class="import-warning">This file doesn’t record which template it was exported under (an older export). Rows are still matched by dimension name only.</div>';
    }

    var skipsHtml = "";
    if(plan.skipped.length){
      skipsHtml = '<div class="import-skips">' + plan.skipped.slice(0,50).map(function(s){
        return '<div class="srow">Row '+s.row+': “'+esc(s.dimension)+'” not found among current dimensions ('+esc(s.squad)+')</div>';
      }).join("") + '</div>';
    }
    document.getElementById("importSummary").innerHTML = (plan.ratingCount===0 && plan.skipped.length===0)
      ? '<p class="hint" style="margin:0;">No matching rows found in this file.</p>' + templateWarning
      : templateWarning + chips + skipsHtml;
    var applyBtn = document.getElementById("importApplyBtn");
    applyBtn.disabled = plan.ratingCount===0;
  }

  function closeImport(){ importBackdrop.hidden = true; pendingImportPlan = null; }
  document.getElementById("importCancel").addEventListener("click", closeImport);
  importBackdrop.addEventListener("click", function(e){ if(e.target===importBackdrop) closeImport(); });

  document.getElementById("importApplyBtn").addEventListener("click", function(){
    if(!pendingImportPlan || pendingImportPlan.ratingCount===0) { closeImport(); return; }
    applyImportPlan(pendingImportPlan);
    closeImport();
  });

  function applyImportRatingsToSquad(sq, dims){
    // clone before mutating -- sq.dimensions may be a plain object we built
    // ourselves, but stay consistent with the frozen-snapshot precaution used
    // everywhere else ratings are written
    sq.dimensions = Object.assign({}, sq.dimensions);
    Object.keys(dims).forEach(function(dimKey){
      var d = dims[dimKey];
      var rec = { color: d.color };
      if(d.trend) rec.trend = d.trend;
      if(d.note) rec.note = d.note;
      sq.dimensions[dimKey] = rec;
    });
    if(state.live && state.db){
      var patch = { dimensions:{}, updatedAt: nowIso() };
      Object.keys(dims).forEach(function(dimKey){ patch.dimensions[dimKey] = sq.dimensions[dimKey]; });
      state.db.collection("squads").doc(sq.id).update(patch).catch(function(err){
        diag("CSV import: write failed for squads/" + sq.id + ": " + (err && err.code ? err.code : String(err)));
      });
    }
  }

  function applyImportPlan(plan){
    var newOnes = plan.patches.filter(function(p){ return !p.existing; });
    function applyAll(){
      plan.patches.forEach(function(p){ if(p.existing) applyImportRatingsToSquad(p.existing, p.dims); });
      renderAll();
      diag("CSV import applied: " + plan.ratingCount + " rating(s) across " + plan.patches.length + " " + unitPluralLower() + ".");
    }
    if(newOnes.length===0){ applyAll(); return; }
    var maxOrder = state.squads.reduce(function(m,s){ return Math.max(m, s.order||0); }, 0);
    if(state.live && state.db){
      showBusy("Importing " + newOnes.length + " new " + (newOnes.length===1?unitLower():unitPluralLower()) + "…");
      Promise.all(newOnes.map(function(p, i){
        return state.db.collection("squads").add({ name:p.name, order:maxOrder+1+i, dimensions:{}, updatedAt: nowIso() })
          .then(function(ref){ p.existing = { id: ref.id, name:p.name, order:maxOrder+1+i, dimensions:{} }; });
      })).then(function(){ hideBusy(); applyAll(); }).catch(function(err){
        hideBusy();
        diag("CSV import: creating new " + unitPluralLower() + " failed: " + (err && err.code ? err.code : String(err)));
      });
    } else {
      newOnes.forEach(function(p, i){
        var sq = { id:"local-"+Date.now()+"-"+i, name:p.name, order:maxOrder+1+i, dimensions:{} };
        state.squads.push(sq);
        p.existing = sq;
      });
      applyAll();
    }
  }

  // ---------- live sync ----------
  function setSyncStatus(live){
    document.getElementById("syncDot").classList.toggle("off", !live);
    document.getElementById("syncText").textContent = live ? "Live — synced across viewers" : "Preview only — not connected";
  }

  async function initDb(){
    try{
      diag("Requesting db capability... (window.claude present: " + !!(window.claude) + ")");
      var db = await (window.claude && window.claude.use ? window.claude.use("db") : Promise.resolve(null));
      if(!db){ diag("db capability resolved to null -- running in local-only preview mode"); setSyncStatus(false); return; }
      diag("db capability granted.");
      state.db = db;
      state.live = true;
      setSyncStatus(true);

      if(isJoinMode()){
        listenJoinSession();
      } else {
        var sessSnapCount = 0;
        db.collection("sessions").onSnapshot(function(snap){
          sessSnapCount++;
          var docs = snap.docs.map(function(doc){ return Object.assign({ id: doc.id }, doc.data() || {}); });
          diag("Sessions snapshot #" + sessSnapCount + ": " + docs.length + " doc(s)");
          state.sessions = docs;
          if(state.ui.view==="squad") renderSquadView();
        }, function(err){ diag("Sessions snapshot listener error: " + (err && err.code ? err.code : String(err))); });
      }

      var squadSnapCount = 0;
      db.collection("squads").orderBy("order").onSnapshot(function(snap){
        squadSnapCount++;
        var docs = snap.docs.map(function(doc){
          var data = doc.data() || {};
          // snapshot data is frozen -- clone dimensions into a plain mutable
          // object (and each dimension record) before it enters local state
          var rawDims = data.dimensions || {};
          var dims = {};
          Object.keys(rawDims).forEach(function(k){
            var v = rawDims[k] || {};
            dims[k] = { color: v.color, trend: v.trend, note: v.note };
          });
          return { id: doc.id, name: data.name || "Untitled squad", order: data.order || 0, dimensions: dims };
        });
        diag("Squad snapshot #" + squadSnapCount + ": " + docs.length + " doc(s) [" + docs.map(function(d){return d.id;}).join(",") + "]" + (snap.metadata && snap.metadata.fromCache ? " (from cache)" : ""));
        state.squads = docs;
        renderAll();
      }, function(err){ diag("Squad snapshot listener error: " + (err && err.code ? err.code : String(err))); setSyncStatus(false); });

      var dimSnapCount = 0;
      db.collection("dimensions").orderBy("order").onSnapshot(function(snap){
        dimSnapCount++;
        // build brand-new plain objects -- never hand out the frozen
        // snapshot data itself, since dimension rows get edited in place later
        var docs = snap.docs.map(function(doc){
          var data = doc.data() || {};
          var dim = { key: doc.id, label: data.label || "", green: data.green || "", red: data.red || "", order: data.order || 0 };
          // optional content for the scored-survey rating flow -- not built yet,
          // but a dimension loaded from a starter template like Five
          // Dysfunctions carries these through the live snapshot so they aren't
          // silently dropped in the meantime
          if(data.statements && data.statements.length) dim.statements = data.statements;
          if(data.scoreBands) dim.scoreBands = data.scoreBands;
          if(data.strategies && data.strategies.length) dim.strategies = data.strategies;
          return dim;
        });
        diag("Dimension snapshot #" + dimSnapCount + ": " + docs.length + " doc(s)");
        state.dimensions = docs;
        renderAll();
        if(!dimBackdrop.hidden) renderDimList();
      }, function(err){ diag("Dimension snapshot listener error: " + (err && err.code ? err.code : String(err))); });

      var tplSnapCount = 0;
      db.collection("templates").orderBy("createdAt").onSnapshot(function(snap){
        tplSnapCount++;
        var docs = snap.docs.map(function(doc){
          var data = doc.data() || {};
          var rawDims = data.dimensions || [];
          var dims = rawDims.map(function(d){ return { key:d.key||"", label:d.label||"", green:d.green||"", red:d.red||"", order:d.order||0 }; });
          return { id: doc.id, name: data.name || "Untitled template", unit: data.unit||"", unitPlural: data.unitPlural||"", attribution: data.attribution||"", dimensions: dims };
        });
        diag("Template snapshot #" + tplSnapCount + ": " + docs.length + " doc(s)");
        state.templates = docs;
        if(!templatesBackdrop.hidden) renderTemplateList();
      }, function(err){ diag("Template snapshot listener error: " + (err && err.code ? err.code : String(err))); });

      state.db.doc("meta/config").onSnapshot(function(snap){
        if(!snap.exists) { diag("meta/config does not exist yet -- keeping local defaults"); return; }
        var data = snap.data() || {};
        state.config = {
          unit: data.unit || DEFAULT_CONFIG.unit,
          unitPlural: data.unitPlural || DEFAULT_CONFIG.unitPlural,
          activeTemplateName: data.activeTemplateName || "",
          attribution: data.attribution || ""
        };
        diag("Config snapshot: unit=" + state.config.unit + " template=" + state.config.activeTemplateName);
        renderAll();
      }, function(err){ diag("Config snapshot listener error: " + (err && err.code ? err.code : String(err))); });

    }catch(e){ diag("initDb threw: " + (e && e.message ? e.message : String(e))); setSyncStatus(false); }
  }

  // ---------- boot ----------
  function start(){
    if(isJoinMode()){
      enterJoinMode();
    } else {
      applyViewVisibility();
      renderAll();
    }
    initDb();
  }

  if(window.claude && window.claude.hot){
    window.claude.hot.ready ? window.claude.hot.ready(start) : start();
  } else {
    start();
  }
})();
