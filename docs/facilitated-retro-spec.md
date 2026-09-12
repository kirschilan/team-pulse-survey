# Squad Pulse — Facilitated Retro Spec & Backlog

Status doc for the "SM-facilitated live retro" feature on Squad Pulse
(https://claude.ai/code/artifact/79ff7b71-4ea7-4004-8f5b-338c70615432). Living document — update the
session log at the bottom as stories land, rather than letting this drift from the code.

## The feature, in one paragraph

A Scrum Master picks a squad and a template (e.g. "The Five Dysfunctions of a Team"), starts a
session, and shares a join link/QR code. Each teammate answers the survey on their own device.
Once everyone (or enough people) has answered, the individual results consolidate into the squad's
board rating — the same rating that already flows into Tribe view today. The SM can choose whether
results are visible live as people finish, or held until everyone's submitted, and can override any
of the consolidated dimension ratings before finalizing. The team can also leave a short note about
the experiment they intend to run next sprint.

## Decisions locked in

- **Individual-answer visibility:** anonymous in the UI. Neither the SM nor teammates see who
  answered what — only the squad's consolidated result. This is a UI-level choice, not real access
  control: the Claude Artifacts `db` capability has no server-side security rules, so "anonymous" here
  means "not shown," not "cryptographically unlinkable." Same caveat as the earlier tribe/squad
  visibility decision.
- **Consolidation rule:** for each dimension, bucket each teammate's answer into good/warn/crit, then
  take the majority bucket. On a tie, default to the **calmer** (less severe) bucket — benefit of the
  doubt when the team doesn't agree. The SM (or whoever runs the facilitator screen) can override any
  of the consolidated values and trends by hand, which is exactly how the team can choose to go with
  the more severe read if they want to.
- **5DF scoring (Patrick Lencioni's Five Dysfunctions of a Team, via The Table Group's published
  assessment):** 15 statements, 3 per dysfunction, each answered 1 (Rarely) / 2 (Sometimes) / 3
  (Usually). Sum the 3 statements per dysfunction (range 3–9). Bands: 8–9 = good (not a problem), 6–7
  = warn (could be a problem), 3–5 = crit (needs addressing). This maps directly onto Squad Pulse's
  existing good/warn/crit model — no new color system needed.
- **Storage granularity:** doesn't matter whether all 15 raw answers are stored per person, or the
  consolidation from 15→5 happens client-side and only the 5 per-person subtotals are submitted.
  Implementation's call.
- **Scope holds from the prior phase:** current-snapshot only (no history/trend-over-time yet); no
  real access control (transparent-but-collapsed-by-default is a rendering choice, not a permission
  boundary).

## Data model additions

- A **dimension** can now optionally carry `statements` (array of strings), `scoreBands`
  (`{good, warn}` — score ≥ good → "good", ≥ warn → "warn", else "crit"), and `strategies` (array of
  short suggestions, shown as a takeaway when a dimension lands in warn/crit). All three are additive
  and backward compatible — a dimension without them behaves exactly as today (direct swatch rating).
- A **starter template** (`STARTER_TEMPLATES` in the code) is a built-in, non-deletable template
  definition that isn't stored in the live `templates` collection — it costs nothing just by existing,
  and is always offered in the Templates modal alongside anything the board has saved itself.
- A **session** (not yet built) will be a new `sessions/{id}` doc: squad, dimensions snapshot,
  status (open/closed), reveal mode (live/hold), created timestamp, plus per-participant response
  records scoped under it.

## Starter templates

The retro feature (join code, submission, live facilitator view, override, sprint note, finish &
apply) is generic over any template that carries `statements`/`scoreBands` on its dimensions — it was
built once against the Five Dysfunctions data and needed zero code changes to support a second
instrument. Built-in starter templates so far:

- **The Five Dysfunctions of a Team** (Lencioni, via The Table Group) — 5 dimensions, 3 statements
  each (15 total), summed 3–9, bands 8–9/6–7/3–5 = good/warn/crit. Here "good" means "healthy" in a
  straightforward sense — every statement is phrased as the healthy behavior, so more of it is
  unambiguously better.
- **Tuckman's Team Development Stages** (forming, storming, norming, performing, adjourning) — 5
  dimensions, 4 statements each (20 total), summed 4–12, bands 10–12/8–9/4–7 = good/warn/crit. This one
  is semantically different: a high score doesn't mean "healthy," it means that stage is *currently
  prominent* — the source material's own three-tier read (prominent / emerging-transitioning / not
  characteristic). We reused the existing good/warn/crit mechanism to carry that reading rather than
  invent a new one, and each dimension's green/red anchor text spells out what the color actually means
  for that stage (e.g. a red "Storming" pill is good news, not a problem to fix) — the SM and team read
  the anchor text, not just the color, to know what's going on. Added from a user-supplied `.docx`
  questionnaire (20 statements, 4 per stage, 1/2/3 scale, plus the source's own score-interpretation
  and per-stage strategies-for-moving-through text, which map directly onto `strategies`).

## Story backlog

Each story is independently demoable before the next starts.

1. **Scored-survey template type — DONE.** Extended the template/dimension data model to optionally
   carry `statements`/`scoreBands`/`strategies`, and added "The Five Dysfunctions of a Team" as a
   built-in starter template with all 15 statements, green/red anchors, score bands, and the
   published overcoming-strategies. It shows up in the Templates modal under a new "Starter
   templates" section (Load only, no delete), loads and reloads exactly like any user-saved template
   (same dimension-key-stability guarantee, so ratings survive a reload), and is visually flagged as
   "scored from statements" in both the Templates list and the dimension editor. Existing templates
   and the direct swatch-rating flow are completely unaffected. Verified with Playwright against the
   fake-db harness plus the full existing regression suite (zero JS errors); screenshotted for visual
   QA. Published as Version 12→13 of the live artifact (confirm exact version at publish time).
2. **Session shell — DONE.** Squad view now has a "Retro session" card. With no session open for the
   selected squad it shows a "Start retro session" button; starting one snapshots the board's
   current dimensions (so a later template change doesn't retroactively alter a session already
   running) into a new `sessions/{id}` doc (squadId, squadName, templateName, dimensions, status:
   "open", revealMode: "hold", createdAt) and the card switches to "Retro session in progress" with a
   Close button. Sessions are independent per squad — starting one for Squad 1 doesn't affect Squad
   2's picker. Doesn't touch `squad.dimensions` at all yet.
   - **Changed (2026-09-12):** closing a session no longer deletes the doc outright — it updates
     `status` to `"closed"` instead (see `STATUS.md`'s locked decisions for why: it lets a
     participant already on the join screen see a real "this retro has ended" instead of the same
     generic message a bad code gets). The doc still goes away once the relay's own room-empty grace
     period elapses; this only widened the window in which "closed" is distinguishable, on top of a
     database-free relay that was built after this story originally shipped. Nothing about the
     session shell itself (start/close UX, per-squad independence) changed.
3. **Join link + QR, with a typed session code as the primary path — DONE.** Each open session now
   gets a short, human-typeable 6-character code (e.g. `W6G2F3`, drawn from an alphabet that excludes
   ambiguous characters like 0/O/1/I/L) that doubles as the session doc's id. The session card leads
   with this code front-and-center, plus a "Join a retro" button in the header that any device can tap
   to open a small modal and type the code in — no URL or query string involved at all. The original
   join link + inline-SVG QR code (bundled `qrcode-generator` by Kazuhiko Arase, MIT, embedded rather
   than CDN-loaded) still exist as a secondary "Or scan/share a link" fallback, collapsed by default,
   with an explicit caveat about the phones where scanning it doesn't work. Either path lands on the
   same dedicated join screen (no Tribe/Squad/Admin switcher at all), watching that one session doc
   live: "You're joining `<squad>`'s retro," the retro's name, and its dimensions listed read-only — no
   rating controls yet (that's Story 4). An invalid/closed session (bad link or bad typed code) shows a
   plain "this session isn't open" message instead of erroring. Verified against the fake-db harness
   simulating three separate devices (URL-based join, typed-code join, and the header button/modal/
   Escape-to-cancel interaction), plus the full existing regression suite — zero JS errors.
   Published as Version 14, then Version 15 for the session-code fix below.
   - **Fix (2026-09-10):** the user reported that scanning the QR on an actual iPhone opened the
     Claude app to the regular Squad Pulse board, not the join screen — most likely (unverified from
     this sandbox, no way to test real iPhone/Claude-app link handling) because the Claude iOS app
     intercepts `claude.ai` links as a universal link and opens its own artifact viewer for that id
     without carrying the `?session=...` query string into the rendered page. Since a query string
     can't be relied on to survive that hand-off on every device, the session code was added as the
     primary, environment-proof join method (pure in-page state, no URL dependency), demoting the QR/
     link to a secondary convenience.
4. **Individual submission — one dysfunction, end to end — DONE.** Re-scoped down from "all 15
   questions at once" after Story 3's integration bug (QR/join breaking on a real device) showed the
   cost of building the whole submission flow before proving the join→submit→facilitator loop actually
   works live. This story ships the *complete* loop for just Dysfunction 1 (Absence of Trust, 3
   statements): the join page renders those 3 statements as a 1/2/3 form (Rarely/Sometimes/Usually),
   Submit stays disabled until all three are answered, and on submit the person's answers are stored
   anonymously in a `sessions/{id}/responses` subcollection (kept separate from the session doc itself
   so submitting never touches, and can't race, the session's own fields). The participant immediately
   sees their own DF1 result: score, good/warn/crit band, the pyramid's characterization line, and —
   for anything short of green — the matching "strategies for overcoming" takeaways. The facilitator's
   session card watches that subcollection live and shows how many teammates have submitted plus the
   consolidated DF1 band using the majority/calmer-tie rule, unconditionally (no live/hold gating yet
   — that's Story 6). The other four dimensions still just list read-only, unchanged, until Story 5.
   Verified against the fake-db harness: a full SM→participant→live-update loop, the majority
   consolidation with a real 2-good/1-crit split, and the good/crit tie explicitly resolving to the
   calmer bucket (good) as decided — plus the full existing regression suite, zero JS errors.
   **Caught and fixed one real bug in testing**: the Submit button's "all three statements answered"
   check used `new Array(3)`, a *sparse* array — `Array.prototype.every()` vacuously returns true over
   unset slots in a sparse array, so Submit was silently enabled before any statement had been
   answered. Fixed by explicitly filling the draft array with a `null` sentinel. Published as
   Version 17.
5. **Individual submission — the remaining four dysfunctions — DONE.** Extended Story 4's proven
   pipeline to all five dysfunctions in one atomic submission, rather than one dimension at a time.
   `scoredDimensions()` replaced the old `firstScoredDimension()` helper and now returns every scored
   dimension in order; the join page renders one statement section per dimension (5 sections, 15
   statement rows total) under a single form, with one Submit button gated on all 15 being answered
   (not just one dimension's 3) — the Story 4 sparse-array fix (`.fill(null)` instead of a bare
   `new Array(n)`) was carried forward per-dimension since it's exactly the same completion-check
   gotcha at 5x the surface area. Submitting writes one response doc to `sessions/{id}/responses`
   covering all 5 dimension keys, and the participant immediately sees five stacked personal-result
   blocks (score, band, characterization, strategies-if-not-green) — one per dysfunction. The
   facilitator's live view now lists all 5 dimensions' consolidated pills instead of just DF1's.
   Verified against the fake-db harness: a participant answering all 15 statements with the Submit
   button staying disabled until 15/15, one atomic write covering all 5 keys, all 5 personal-result
   blocks rendering correctly, and the facilitator side picking up all 5 pills after a simulated
   submission — plus the full regression suite, zero JS errors.
   - **Refinement (2026-09-10):** the original published Five Dysfunctions assessment presents its 15
     statements in one flat list — deliberately not grouped or titled by dysfunction, so a respondent
     can't tell which dysfunction a given question is scoring. The app's join form initially grouped
     them under a heading per dimension instead; fixed by interleaving the statements round-robin (the
     1st statement of every dimension, then the 2nd of every dimension, then the 3rd) via a new
     `interleavedStatements()` helper, and dropping the per-dimension headings from the form entirely.
     This is a fixed, deterministic order rather than a random shuffle on purpose — the join screen
     re-renders on every session-doc change (e.g. the SM flipping the reveal toggle), and a fresh
     random order on each render would reshuffle the questions out from under someone mid-survey.
     Scoring, the personal-results breakdown, and the facilitator's per-dimension view are all
     unaffected — only the *answering* form stopped revealing the grouping. Verified the rows render in
     the expected round-robin order (trust/conflict/commitment/accountability/results, repeated 3
     times) with no dimension headings anywhere in the form, plus the full regression suite.
6. **Facilitator live/hold toggle — DONE.** Stories 4–5 showed the consolidated result live,
   unconditionally; this story added the actual gating. There's no roster/headcount anywhere in the
   app, so "everyone's submitted" can't be auto-detected — the SM flips a manual switch (two buttons,
   "Held"/"Live") that's persisted directly on the shared session doc's `revealMode` field (default
   `"hold"`), not just a local UI flag, so it's consistent for anyone watching that session. While held,
   the facilitator's session card shows only the submission count ("Results held — N submitted"); once
   flipped to live, it additionally shows the per-dimension `.live-dim-row` pills built in Story 5. A
   distinct `.reveal-btn` CSS class (rather than reusing `.view-btn`) was used deliberately, since the
   existing `applyViewVisibility()` function strips `.active` from every `.view-btn` on the page
   whenever the header's Tribe/Squad/Admin switcher is used, keyed on a `data-view` attribute the reveal
   buttons don't carry — reusing the class would have silently broken the toggle's visual state on
   every unrelated view switch. Verified against the fake-db harness with 5 simulated submissions
   (including a genuine 2-good/2-crit tie on one dimension, confirmed to resolve to the calmer/good
   bucket exactly as decided, and a 2-good/2-crit/1-warn split correctly resolving on plurality rather
   than a tie), the toggle's state confirmed to actually change the shared session doc (not just a
   local flag), pills correctly appearing/disappearing on flip, and the toggle state surviving a
   switch away to another squad and back (subscription lifecycle re-attaches correctly) — plus the
   full regression suite, zero JS errors.
7. **Facilitator consolidation table + override — DONE.** While in live mode, each dimension row now
   carries a small pencil button that opens the same rating-editor modal used elsewhere on the board,
   in a new "session override" mode: it pre-selects the current live-consolidated color, lets the SM
   pick a different color/trend and leave a short note, and shows a "Use consolidated result" button
   to clear the override once one exists. The override is stored on the *session* doc itself
   (`sessions/{id}.overrides.{dimKey}`), not the squad — it's a live, shared "what we'll actually go
   with" annotation on top of the raw consolidation, and only becomes the squad's real rating once the
   retro is finished (Story 9). An "Overridden" tag and, when the override sets a trend, the usual
   up/down arrow appear next to the pill so it's clear at a glance the number isn't the raw majority
   vote. Below the pills, a collapsed "See all N responses" table lists one anonymous row per submitted
   teammate with their own per-dimension band — more granular than the consolidated pills, so it's
   gated behind live mode exactly like the pills are, and wrapped in the same horizontal-scroll
   container the Tribe heatmap already uses. Verified against the fake-db harness: opening the editor
   pre-fills the live consolidated value when there's no override yet, saving one persists it to the
   session doc (not just a local flag) and updates the pill/tag/trend immediately, reopening shows the
   existing override and reveals the reset button, resetting clears it back to the raw consolidation,
   and the response table's per-response, per-dimension cells match the seeded data exactly — plus the
   full regression suite, zero JS errors.
8. **Sprint experiment note — DONE.** A "Sprint experiment" textarea now sits on every session card
   (regardless of whether the template has scored dimensions), backed by a new `experimentNote` field
   on the session doc, with an explicit Save button rather than saving per keystroke — the sessions
   listener re-renders this whole card on every remote change, which would otherwise yank focus out of
   the textarea mid-sentence. Saving shows a brief "Saved" confirmation. Verified the note round-trips
   through the session doc and that saving doesn't disturb an in-progress edit.
9. **Close and write to squad — DONE.** A new "Finish retro & apply results" button (shown whenever the
   session has scored dimensions, alongside the existing plain "Close session") computes, for every
   scored dimension, the same override-or-consolidated result Story 7's pills show, and — after a
   confirmation listing exactly what will change, dimension by dimension — writes those colors/trends
   into the squad's own rating cells through the existing `persistDimensionRating` write path (extended
   to a batched `persistDimensionRatings` so all of them land in one update), preserving each
   dimension's existing note. The session then closes exactly like a normal close. A dimension with
   neither an override nor any submissions is left untouched rather than being overwritten with
   nothing. Because this reuses the squad's existing rating field, the results show up in Tribe view
   automatically — no new Tribe-view code was needed, matching the plan. If nothing was submitted or
   overridden yet, "Finish retro" just closes the session with a plain confirmation instead of a
   no-op write. Verified end to end: finishing with zero data closes without touching the squad;
   finishing with real submissions plus one manual override writes exactly those colors (including the
   overridden one) into the squad's dimensions, the squad's own rating cells reflect it immediately,
   and the values are exactly what Tribe view already reads — plus the full regression suite, zero JS
   errors.

This closes out the full story backlog for the facilitated-retro feature (Stories 1–9).

## Bug fix (2026-09-10): Spotify Squad Health Check dimensions weren't answerable in Retro mode

The retro pipeline (Stories 2–9) was built and proven entirely against statement-based dimensions
(Five Dysfunctions, then Tuckman). The board's own *default* template — Spotify Squad Health Check,
12 dimensions with a direct green/yellow/red pick and no `statements` at all — was never actually
wired into it: `scoredDimensions()` filtered a session's dimensions down to statement-only ones, so
a session on the default template always got an empty `activeDims`, and the join screen fell through
to a permanent read-only listing ("Your Scrum Master will let you know when to answer"). A teammate
could open the join link and never see anything they could actually click — only the facilitator
could rate those dimensions, by hand, on the squad view, which is what the bug report described
("facilitator can still fill in choices on behalf of the team").

Fix: every dimension in a retro is answerable now, through one of two mechanisms depending on its
shape — this was a gap in Retro mode's coverage, not a change to the Spotify dimension set itself,
which is unchanged.

- **Statement dimensions** (has `statements`) — unchanged: the blind, interleaved Likert survey.
- **Direct-rating dimensions** (no `statements`) — new: one openly-labeled row per dimension (not
  hidden/interleaved, since Spotify's own exercise is about consciously naming which dimension you're
  rating), with a green/yellow/red swatch pick — the same swatches the facilitator's rating modal
  already uses, so it looks identical whether a teammate or the facilitator makes the pick. The
  dimension's own green/red anchor text is shown as a hint above the swatches.

Both kinds submit in the same atomic response doc and consolidate through the same majority/
calmer-tie logic — `bandForResponse()` now branches on whether a dimension has statements (sum +
score) or reads the response's direct color pick as the band directly. Facilitator override, the
per-response table, the sprint-experiment note, and "Finish retro & apply results" all work
unchanged for direct-rating dimensions too, since they were already generic over `effectiveDimResult`
by dimension key. A personal result for a direct-rating dimension shows its pill without a numeric
score badge (there's no sum to show).

Verified end to end with a new dedicated test (a teammate submits swatch picks for all 3 dimensions
of a Spotify-template session, one deliberately red; the facilitator sees the consolidated live
results, overrides the red one to yellow, and finishing the retro writes Green/Green/Yellow into the
squad's real ratings) plus the full regression suite, zero JS errors. One older test
(`test_retro_join_flow.py`, then named `test_v7.py`, predating the statement-survey work) had encoded
the very bug being fixed — it asserted the Spotify dimensions showed up read-only — and was updated
to assert they're now answerable direct-rating rows instead. Published as Version 22.

## Deliberately not built (yet)

- **Session/retro history** — browsing past sessions over time. Out of scope per the "current
  snapshot only" call. Revisit only if historical trend becomes a real, stated need.
- **Real access control** — anything stronger than "hidden by default in the UI." Would require a
  different hosting approach than the Claude Artifacts `db` capability; revisit only if someone
  states a concrete requirement that the UI-level hiding doesn't satisfy.

## Session log

- 2026-09-10 — Locked scope decisions (anonymous-in-UI, calmer-on-tie consolidation, 5DF scoring
  from the Lencioni assessment PDF). Shipped Story 1 (scored-survey template type + Five Dysfunctions
  starter template). Stories 2–9 not started.
- 2026-09-10 — Shipped Story 2 (session shell: start/close a live session per squad) and Story 3
  (join link + inline-SVG QR code, plus the participant join screen). Stories 4–9 not started.
- 2026-09-10 — Fixed a real bug found on first use: scanning the QR on an iPhone opened the Claude
  app's own board view instead of the join screen (the query string likely doesn't survive the
  app's universal-link hand-off). Added a 6-character session code as the primary join method — a
  "Join a retro" header button opens a small modal to type it in, no URL involved — with the QR/link
  demoted to a collapsed "Or scan/share a link" fallback. Published as Version 15.
- 2026-09-10 — Also cleaned up a stale pre-fix session left on the live board (its id was a long
  Firestore-style auto-ID, incompatible with the new short-code join box) and widened the join-code
  input's max length as a safety margin. Published as Version 16.
- 2026-09-10 — Re-scoped Stories 4–5 after the Story 3 integration bug: rather than building the full
  15-question submission flow in one shot, Story 4 now proves the whole join→submit→facilitator loop
  on just Dysfunction 1 (3 questions) first, and Story 5 extends that proven shape to the remaining 12
  questions. Smaller, independently-verifiable steps given how costly the last integration surprise
  was.
- 2026-09-10 — Shipped the re-scoped Story 4: DF1 submission, personal result, and the live
  facilitator tally (majority-with-calmer-tie), end to end. Testing caught a real sparse-array bug in
  the Submit-button gating before it shipped. Published as Version 17. Story 5 (the remaining four
  dysfunctions) not started.
- 2026-09-10 — Shipped Story 5 (all 5 dysfunctions, 15 statements, one atomic submission, 5 stacked
  personal-result blocks, all 5 dimensions in the facilitator's live view) and Story 6 (the manual
  live/hold reveal toggle, persisted on the shared session doc's `revealMode` field, gating whether the
  facilitator sees the per-dimension pills or just a submission count). Re-verified the
  majority/calmer-tie consolidation rule at N=5 including a real 2-2 tie, and confirmed the toggle's
  state is genuinely shared (written to the session doc, not a local flag) and survives switching
  squads and back. Published as Version 18. Stories 7–9 (consolidation table + override, sprint
  experiment note, close-and-write-to-squad) not started.
- 2026-09-10 — Shipped Story 7 (per-dimension override via the existing rating-editor modal in a new
  "session" mode, stored on the session doc, plus a collapsed per-response consolidation table), Story
  8 (a Save-button-gated sprint-experiment note on the session), and Story 9 (a "Finish retro & apply
  results" action that writes the override-or-consolidated result for each scored dimension into the
  squad's own rating in one batched update, then closes the session — reusing the existing rating field
  so Tribe view picks it up with no new code). Verified end to end against the fake-db harness,
  including a manual override actually changing what gets written to the squad, and a no-op finish
  when nothing was submitted or overridden. Published as Version 19. This completes the full Stories
  1–9 backlog for the facilitated-retro feature.
- 2026-09-10 — Fixed a fidelity issue in the join survey: it was grouping and titling statements by
  dysfunction, which the real published assessment deliberately avoids (its 15 statements are one flat,
  unlabeled list, precisely so a respondent can't tell which dysfunction a question is scoring).
  Statements are now interleaved round-robin across the 5 dysfunctions and shown with no per-dimension
  headings; the order is fixed/deterministic rather than randomized, since the join screen re-renders
  live and a fresh shuffle each time would move questions out from under someone mid-survey. Scoring
  and all the results views are unaffected. Published as Version 20.
- 2026-09-10 — Added a second built-in starter template, Tuckman's Team Development Stages (forming,
  storming, norming, performing, adjourning), from a user-supplied `.docx` questionnaire — 20
  statements (4 per stage), same 1/2/3 scale, bands 10–12/8–9/4–7 taken from the source's own
  score-interpretation guide, and its per-stage "strategies for moving through" text mapped onto
  `strategies`. No app code changed beyond the template data itself: the whole retro pipeline (join,
  interleaved statement order, submission, personal results, live facilitator view, override, finish &
  apply) is generic over any `statements`/`scoreBands` template and worked immediately, including with
  a different shape (4 statements per dimension instead of 3, and different thresholds). Noted in the
  template's green/red anchor text that a high score here means "this stage is currently prominent," not
  "healthy" — the color mechanism is being reused for a different kind of reading than the Five
  Dysfunctions template, since Tuckman doesn't have a universal "more is better" direction across all 5
  stages. Verified end to end via the fake-db harness (template listed and loads correctly, all 20
  statements presented in the expected interleaved order, scoring lands in the expected bands including
  a same-boundary check, and the facilitator's live view and finish-and-apply flow both work unchanged)
  plus the full regression suite, zero JS errors. Published as Version 21.
- 2026-09-10 — Fixed a real gap reported after using the board's default Spotify Squad Health Check
  template in Retro mode: teammates couldn't answer anything (only the facilitator could rate by hand
  on the squad view), because the retro pipeline only ever recognized statement-based dimensions as
  answerable. Every dimension is answerable now — direct-rating dimensions get an openly-labeled
  green/yellow/red swatch pick instead of the blind statement survey. See "Bug fix" section above.
  Published as Version 22.
- 2026-09-12 — Migrated off the Claude Artifact sandbox to a standalone deployment with a real
  cross-device relay (see `STATUS.md`, whose session log now carries this feature's ongoing history
  going forward — not duplicated here). One change to this doc's own record: closing a session
  updates `status` to `"closed"` rather than deleting the doc, so a participant's join screen can
  say "this retro has ended" — see Story 2's note above. The retro pipeline itself (consolidation,
  overrides, sprint note, finish-and-apply) is unchanged; `retro.js` was later split into
  `retro-facilitator.js`/`retro-join.js` along the device-role boundary this spec already implies
  throughout, with zero intended behavior change.
