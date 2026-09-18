from playwright.sync_api import sync_playwright
import pathlib, json, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index, test_output_path

# REF-1 (STATUS.md's "Code quality & refactoring backlog"): JSON board
# import's persistence writes (applySquadImportPlan()/
# applyDimensionTemplateConfigImportPlan() in board-import-apply.js) used
# to route through syncLiveIfConnected() -- fire-and-forget, no way for a
# caller to await it. The import modal closed and the "JSON import
# applied" diagnostic fired synchronously right after ISSUING the writes,
# never after they actually settled, and a write that genuinely rejected
# was invisible except for its own one-line diagnostic -- the false
# "applied" success line still fired regardless.
#
# tests/test_json_import.py (the existing Playwright coverage for this
# flow) only ever runs against fake_store.html, an in-memory stand-in with
# no reload persistence at all -- it structurally can't prove a write
# really landed on a real backend before "applied" is reported. This file
# uses write_plain_index() instead: the REAL public/local-store.js, backed
# by real localStorage. (Board-export-import.js's writes -- squads/
# dimensions/templates/config -- are never relay-routed; only
# "sessions"/"boards" paths go to relay/server.js, per local-store.js's
# isRelayPath(). local-store.js, not the relay, is the "real, not fake"
# backend this specific flow actually runs against.)

INDEX = write_plain_index(out_name="_test_json_import_write_completion_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())


def goto_admin_import(page):
    page.goto(INDEX_URL)
    page.wait_for_function("() => !document.getElementById('syncText').textContent.includes('Connecting')")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_selector('#importJsonBtn', state="visible")


def open_with_file(page, payload_text, filename):
    p = test_output_path(filename)
    p.write_text(payload_text)
    page.set_input_files('#jsonFileInput', str(p))
    page.wait_for_selector('#importJsonBackdrop:not([hidden])')


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- Scenario A: a brand-new dimension + a rating that references it,
    # in ONE import, against the REAL backend -- proves both the
    # already-correct creation-before-rating ordering AND that "applied"
    # only fires once the writes have genuinely, durably landed (a reload
    # against fake_store.html can't prove this at all; it has nothing to
    # reload from). ----
    ctx_a = browser.new_context(viewport={"width": 1280, "height": 1000})
    page_a = ctx_a.new_page()
    errors_a = []
    page_a.on("pageerror", lambda e: errors_a.append(str(e)))
    goto_admin_import(page_a)

    new_dim_file = {
        "formatVersion": 1,
        "dimensions": [
            {"key": "newdim", "label": "New Dim", "green": "Great", "red": "Bad", "order": 99}
        ],
        "squads": [
            {"name": "Squad 1", "dimensions": {"newdim": {"color": "good"}}}
        ]
    }
    open_with_file(page_a, json.dumps(new_dim_file), "new_dim_and_rating.json")
    page_a.wait_for_selector('#importJsonApplyBtn:not([disabled])')
    page_a.click('#importJsonApplyBtn')
    # Real signal, not a guessed wait: the modal only becomes hidden once
    # the whole import (dimension creation + the rating that depends on
    # it) has actually settled -- see board-import-preview.js's Apply
    # handler.
    page_a.wait_for_selector('#importJsonBackdrop[hidden]', state="attached")

    diag_a = page_a.eval_on_selector("#diagLog", "el=>el.textContent")
    print("=== Scenario A: diag after apply ===")
    print(diag_a)
    assert "JSON import applied" in diag_a

    print("=== Scenario A: reload against the REAL backend -- must survive ===")
    page_a.reload()
    page_a.wait_for_function("() => !document.getElementById('syncText').textContent.includes('Connecting')")
    stored = page_a.evaluate("JSON.parse(localStorage.getItem('squadpulse:db:v1'))")
    dim_entries = [(k, v) for k, v in stored.items() if k.startswith("dimensions/") and v.get("label") == "New Dim"]
    assert len(dim_entries) == 1, "the new dimension must have really persisted to localStorage"
    new_dim_key = dim_entries[0][0].split("/", 1)[1]
    squad1 = stored.get("squads/squad-1")
    assert squad1 is not None
    assert squad1["dimensions"].get(new_dim_key, {}).get("color") == "good", (
        "the rating for the newly-created dimension must have resolved to its REAL key and persisted -- "
        "proves the dimension-creation-before-rating-import ordering holds against the real backend, "
        "not just fake_store.html's in-memory store"
    )
    ctx_a.close()

    # ---- Scenario B: force one write to genuinely reject, and prove the
    # failure is visible and DISTINGUISHABLE from success -- today's bug:
    # the generic "JSON import applied" line fires unconditionally,
    # regardless of whether any write actually succeeded. ----
    ctx_b = browser.new_context(viewport={"width": 1280, "height": 1000})
    page_b = ctx_b.new_page()
    errors_b = []
    page_b.on("pageerror", lambda e: errors_b.append(str(e)))
    goto_admin_import(page_b)

    # Deliberately force squads/squad-1's own update() to reject -- a
    # legitimate way to prove the failure-visibility contract without
    # depending on a real, hard-to-engineer backend failure mode (every
    # existing-doc update() in this flow genuinely succeeds against a real
    # local-store.js under normal conditions).
    page_b.evaluate("""() => {
      var origCollection = state.db.collection.bind(state.db);
      state.db.collection = function(name){
        var ref = origCollection(name);
        if (name !== "squads") return ref;
        var origDoc = ref.doc.bind(ref);
        ref.doc = function(id){
          var docRef = origDoc(id);
          if (id === "squad-1") {
            docRef.update = function(){ return Promise.reject({code:"test-forced-failure", message:"forced for test"}); };
          }
          return docRef;
        };
        return ref;
      };
    }""")

    rating_update_file = {
        "formatVersion": 1,
        "squads": [
            {"name": "Squad 1", "dimensions": {"release": {"color": "crit"}}}
        ]
    }
    open_with_file(page_b, json.dumps(rating_update_file), "forced_failure.json")
    page_b.wait_for_selector('#importJsonApplyBtn:not([disabled])')
    page_b.click('#importJsonApplyBtn')
    page_b.wait_for_selector('#importJsonBackdrop[hidden]', state="attached")

    diag_b = page_b.eval_on_selector("#diagLog", "el=>el.textContent")
    print("=== Scenario B: diag after a forced write failure ===")
    print(diag_b)
    assert "failed" in diag_b, "the specific write failure must still be visible"
    # "JSON import applied (" is the squads/ratings plan's OWN success line
    # (board-import-apply.js's applySquadImportPlan()) -- distinct from the
    # legitimately-separate "JSON import applied to dimensions/templates/
    # board settings" line, which is allowed to still say success here since
    # the dimensions/templates/config part of THIS import genuinely had
    # nothing to do (no dimensions/templates section in this file) and
    # nothing in it failed.
    assert "JSON import applied (" not in diag_b, (
        "the squads/ratings success line must NOT fire when its own write genuinely failed -- "
        "this is the exact bug REF-1 describes: success was reported unconditionally"
    )
    assert "did not fully complete" in diag_b

    # The board must not silently look consistent either: squad-1's release
    # rating must NOT have moved to "crit" locally, since the one write that
    # would have set it rejected.
    stored_b = page_b.evaluate("JSON.parse(localStorage.getItem('squadpulse:db:v1'))")
    assert stored_b["squads/squad-1"]["dimensions"].get("release", {}).get("color") != "crit"
    ctx_b.close()

    # ---- Scenario C (Codex review finding on PR #20): a REJECTED write and
    # a genuinely DELAYED write in the same import -- Promise.all() rejects
    # the instant the FIRST one settles (the rejection), without waiting for
    # the delayed one, so the modal closed and "did not fully complete" was
    # reported while the delayed write was still in flight in the
    # background -- and that write then landed AFTER the user had already
    # been told the import was done. Fixed with Promise.allSettled(): the
    # whole operation now waits for every issued write, however slow,
    # before reporting anything. ----
    ctx_c = browser.new_context(viewport={"width": 1280, "height": 1000})
    page_c = ctx_c.new_page()
    errors_c = []
    page_c.on("pageerror", lambda e: errors_c.append(str(e)))
    goto_admin_import(page_c)

    page_c.evaluate("""() => {
      var origCollection = state.db.collection.bind(state.db);
      state.db.collection = function(name){
        var ref = origCollection(name);
        if (name !== "squads") return ref;
        var origDoc = ref.doc.bind(ref);
        ref.doc = function(id){
          var docRef = origDoc(id);
          if (id === "squad-1") {
            // Rejects IMMEDIATELY -- the write Promise.all() would have
            // settled on first, wrongly ending the whole operation before
            // squad-2's write below ever gets a chance to land.
            docRef.update = function(){ return Promise.reject({code:"test-forced-failure", message:"forced for test"}); };
          }
          if (id === "squad-2") {
            var realUpdate = docRef.update.bind(docRef);
            docRef.update = function(patch){
              return new Promise(function(resolve){
                setTimeout(function(){ resolve(realUpdate(patch)); }, 300);
              });
            };
          }
          return docRef;
        };
        return ref;
      };
    }""")

    mixed_file = {
        "formatVersion": 1,
        "squads": [
            {"name": "Squad 1", "dimensions": {"release": {"color": "crit"}}},
            {"name": "Squad 2", "dimensions": {"release": {"color": "warn"}}}
        ]
    }
    open_with_file(page_c, json.dumps(mixed_file), "mixed_failure_and_delay.json")
    page_c.wait_for_selector('#importJsonApplyBtn:not([disabled])')
    page_c.click('#importJsonApplyBtn')

    # Proving an absence (no positive signal can exist for "hasn't finished
    # yet") -- see docs/DefinitionOfDone.md's own carve-out for exactly this
    # case. squad-2's delayed write resolves after 300ms; checking well
    # before that must show the operation still genuinely in flight, not
    # already reported done.
    page_c.wait_for_timeout(80)
    still_busy = not page_c.eval_on_selector('#busyOverlay', 'el => el.hidden')
    modal_still_open = not page_c.eval_on_selector('#importJsonBackdrop', 'el => el.hidden')
    print("=== Scenario C: 80ms in (well before squad-2's 300ms delayed write resolves) ===")
    print("busy overlay still shown:", still_busy, "-- import modal still open:", modal_still_open)
    assert still_busy, "must still be waiting on squad-2's pending write, not already done"
    assert modal_still_open, "must not report completion while a write is still in flight"

    page_c.wait_for_selector('#importJsonBackdrop[hidden]', state="attached")
    diag_c = page_c.eval_on_selector("#diagLog", "el=>el.textContent")
    print("=== Scenario C: diag once everything has genuinely settled ===")
    print(diag_c)
    assert "did not fully complete" in diag_c
    assert "JSON import applied (" not in diag_c

    stored_c = page_c.evaluate("JSON.parse(localStorage.getItem('squadpulse:db:v1'))")
    assert stored_c["squads/squad-1"]["dimensions"].get("release", {}).get("color") != "crit", (
        "squad-1's write rejected -- its rating must not have landed"
    )
    assert stored_c["squads/squad-2"]["dimensions"].get("release", {}).get("color") == "warn", (
        "squad-2's DELAYED write must have been waited for and landed before completion was reported -- "
        "not abandoned in the background after the modal already closed"
    )
    ctx_c.close()

    print("errors:", errors_a + errors_b + errors_c)
    assert errors_a == []
    assert errors_b == []
    assert errors_c == []
    print("PASS")
    browser.close()
