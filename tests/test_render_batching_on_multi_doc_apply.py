from playwright.sync_api import sync_playwright
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# PERF-2 (STATUS.md's "Runtime performance backlog"): profiling found a real
# render-amplification source distinct from PERF-1's idle LOOP -- a single
# MULTI-DOC write (a remote board snapshot applying N squads + M dimensions,
# via applyRemoteBoardSnapshot()'s Promise.all(ops), or a local starter
# template load) fires renderAll() once per INDIVIDUAL doc write, not once
# for the whole batch. local-store.js's set() calls notify(collectionPath)
# synchronously per doc; db.js's squads/dimensions/config onSnapshot
# listeners each call renderAll() unconditionally on every notify. So
# applying a remote snapshot of N squads + M dimensions costs (N + M + 1)
# full renderAll() passes (each one doing all 8 sub-renders, including every
# hidden view) instead of 1 -- real, measurable waste that scales with board
# size, separate from PERF-1's unbounded idle loop.
#
# Fix: db.js's squads/dimensions/config listeners skip renderAll() while
# `hydrating` (a multi-doc REMOTE apply, board-sync.js's maybeApplyRemote())
# or `suppressingLocalRewrite` (a multi-doc LOCAL rewrite, e.g. loading a
# starter template) is in progress -- `state` still updates on every
# listener fire either way, so nothing goes stale -- then render exactly
# ONCE after the whole batch completes, the same "coalesce, don't drop"
# pattern already used for pushBoardSnapshotIfConnected() during these same
# two windows.
#
# A single-document write (an ordinary rating change, unbatched) must still
# render normally -- this only targets the KNOWN-multi-doc windows, not
# every write in general.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = write_plain_index(out_name="_test_render_batching_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())

# Codex review fix on PR #17: this used to be called fresh before EVERY
# measurement, which re-wrapped whatever window.renderAll currently was --
# each call added another counting layer on top of the previous one instead
# of replacing it, so the 2nd measurement in a run double-counted every real
# call, the 3rd triple-counted, and so on. Installed exactly ONCE per page
# now (idempotent: a second call is a no-op); RESET_COUNTER_JS below is what
# each individual measurement uses to zero the counter, not this.
INSTALL_COUNTER_JS = """
() => {
  if (window.__RENDER_COUNT__ !== undefined) return; // already installed -- don't wrap twice
  window.__RENDER_COUNT__ = 0;
  var _renderAll = window.renderAll;
  window.renderAll = function(){ window.__RENDER_COUNT__++; return _renderAll.apply(this, arguments); };
}
"""
RESET_COUNTER_JS = "() => { window.__RENDER_COUNT__ = 0; }"

# Builds a synthetic remote board snapshot with N squads and M dimensions --
# the exact shape applyRemoteBoardSnapshot()/board-sync.js's own boards/
# <roomId> payload carries (squads/dimensions/config/updatedAt), so this
# exercises the real function, not a stand-in.
BUILD_REMOTE_JS = """
(counts) => {
  var squads = [];
  for (var i = 0; i < counts.squads; i++){
    squads.push({ id: "stress-squad-" + i, name: "Stress squad " + i, order: i, dimensions: {} });
  }
  var dims = [];
  for (var j = 0; j < counts.dims; j++){
    dims.push({ key: "stress-dim-" + j, label: "Stress dim " + j, green: "good", red: "bad", order: j });
  }
  return {
    squads: squads, dimensions: dims,
    config: { unit: "squad", unitPlural: "squads", activeTemplateName: "Stress template", attribution: "" },
    updatedAt: new Date().toISOString()
  };
}
"""

APPLY_REMOTE_JS = """
(remote) => window.maybeApplyRemote("stress-room", remote).then(() => true)
"""


def measure_batch_apply(page, squads, dims):
    page.evaluate(RESET_COUNTER_JS)
    remote = page.evaluate(BUILD_REMOTE_JS, {"squads": squads, "dims": dims})
    page.evaluate(APPLY_REMOTE_JS, remote)
    return page.evaluate("() => window.__RENDER_COUNT__")


def measure_single_edit_render_count(page):
    page.evaluate(RESET_COUNTER_JS)
    # Not "squad-1" specifically -- the batch measurements above already
    # replaced the board's squads with synthetic stress-squad-* ones (a real
    # remote snapshot apply removes whatever the remote doesn't list), so
    # this targets whichever squad row is actually on the page now.
    name_input = page.query_selector('.admin-squad-name')
    name_input.fill("Renamed via single edit")
    name_input.dispatch_event("change")
    page.wait_for_function("() => window.__RENDER_COUNT__ > 0")
    return page.evaluate("() => window.__RENDER_COUNT__")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(INDEX_URL, wait_until="domcontentloaded")
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
    page.click('.view-btn[data-view="admin"]')
    page.evaluate(INSTALL_COUNTER_JS)  # exactly once for the whole page lifetime -- see its own comment

    print("=== documented size 1: the app's own real default board (3 squads, 12 dimensions) ===")
    default_batch_count = measure_batch_apply(page, squads=3, dims=12)
    print("renderAll() calls for one remote snapshot apply at 3 squads/12 dims:", default_batch_count)

    print("=== documented size 2: a generous stress board (40 squads, 25 dimensions) ===")
    stress_batch_count = measure_batch_apply(page, squads=40, dims=25)
    print("renderAll() calls for one remote snapshot apply at 40 squads/25 dims:", stress_batch_count)

    # The fix's whole point: batch size must not change how many times
    # renderAll() runs for the WHOLE multi-doc apply -- it should be a small
    # constant (ideally exactly 1), not one call per doc written.
    assert default_batch_count <= 2, \
        "a small remote snapshot apply (3 squads/12 dims) should coalesce into ~1 render, got %d" % default_batch_count
    assert stress_batch_count <= 2, \
        "a remote snapshot apply must not scale renderAll() calls with board size (40 squads/25 dims -> %d calls, expected a small constant, not one per doc)" % stress_batch_count

    print("=== sanity: an ordinary SINGLE edit (not a multi-doc batch) still renders normally ===")
    single_edit_count = measure_single_edit_render_count(page)
    print("renderAll() calls for one ordinary rating/name edit:", single_edit_count)
    assert single_edit_count >= 1, "a real single edit must still trigger at least one render -- batching must not swallow ordinary updates"

    print("=== per-call cost at the stress size: how long does ONE renderAll() pass actually take? ===")
    per_call_ms = page.evaluate("""
        () => {
          var t0 = performance.now();
          window.renderAll();
          return performance.now() - t0;
        }
    """)
    print("one renderAll() pass at 40 squads/25 dims took %.2fms" % per_call_ms)
    # Generous ceiling (a frame budget is ~16ms; this allows 10x that) --
    # this is a real perf claim like test_idle_tab_sync_loop.py's own
    # evaluate()-latency assertions, not a tight/flaky timing guess.
    assert per_call_ms < 160, "a single renderAll() pass got unexpectedly slow at 40 squads/25 dims: %.2fms" % per_call_ms

    print("errors:", errors)
    assert errors == []
    print("PASS")
    browser.close()
