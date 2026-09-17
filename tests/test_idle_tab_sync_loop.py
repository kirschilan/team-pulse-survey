from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# PERF-1 (backlog: PR #13 / STATUS.md's "Runtime performance backlog"):
# two tabs of the SAME browser, sharing localStorage and both connected to
# the same team board, fall into a self-sustaining sync loop while sitting
# completely idle. Root cause: local-store.js's `storage` event handler
# calls notifyEverything() unconditionally -- every collection/doc listener
# fires on EVERY storage event, even when that specific path's data didn't
# actually change. db.js's squads/dimensions/config listeners each call
# pushBoardSnapshotIfConnected() unconditionally too, so a no-op echo still
# produces a brand-new board push (fresh updatedAt) back to the relay,
# which both tabs are live-subscribed to -- and applying THAT snapshot
# writes local docs again, firing another storage event in the other tab,
# forever. Reported: two idle tabs pinned two renderer processes at
# 128%/138% CPU; one became unresponsive and had to be killed.
#
# The fix has to distinguish "this storage event reflects data I already
# have" from "this storage event carries something new" -- notifying only
# for paths that actually changed, not every path with a listener. A real
# edit must still propagate normally, in both directions and to a
# completely separate browser context (not just the two tabs sharing
# storage) -- this test proves both the fix AND that it didn't just mute
# cross-tab sync altogether.
#
# Uses the REAL local-store.js (write_plain_index(), not fake_store.html)
# and a REAL relay -- this is exactly the gap PR #13's own backlog entry
# flagged: the existing live-subscription test (test_board_sync_live_subscribe.py)
# opens separate browser CONTEXTS, which never share localStorage and so
# never exercises the native `storage` event this bug lives in.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_idle_tab_sync_loop_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8799
RELAY_URL = "ws://localhost:%d" % RELAY_PORT

# Wraps the three functions this loop actually amplifies -- installed on a
# page AFTER boot (so the real function declarations already exist), so
# every later real call (from db.js's listeners, from board-sync.js's own
# apply path) is counted, whatever tab/context happens to invoke it.
INSTALL_COUNTERS_JS = """
() => {
  window.__PERF1__ = { renders: 0, pushes: 0, remoteApplies: 0 };
  var _renderAll = window.renderAll;
  window.renderAll = function(){ window.__PERF1__.renders++; return _renderAll.apply(this, arguments); };
  var _push = window.pushBoardSnapshotIfConnected;
  window.pushBoardSnapshotIfConnected = function(){ window.__PERF1__.pushes++; return _push.apply(this, arguments); };
  var _apply = window.applyRemoteBoardSnapshot;
  window.applyRemoteBoardSnapshot = function(){ window.__PERF1__.remoteApplies++; return _apply.apply(this, arguments); };
}
"""
READ_COUNTERS_JS = "() => Object.assign({}, window.__PERF1__)"


def wait_for_port(port, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


relay_env = dict(os.environ)
relay_env["PORT"] = str(RELAY_PORT)
relay_proc = subprocess.Popen(
    ["node", "server.js"],
    cwd=str(RELAY_DIR),
    env=relay_env,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)

try:
    if not wait_for_port(RELAY_PORT):
        relay_proc.terminate()
        try:
            relay_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            relay_proc.kill()
        out = relay_proc.stdout.read() if relay_proc.stdout else ""
        raise RuntimeError("relay server never opened port %d\n%s" % (RELAY_PORT, out))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        point_at_test_relay = "window.SQUAD_PULSE_RELAY_URL = %r;" % RELAY_URL

        # ============ tab A: creates a team link ============
        # explicit context (not browser.new_page()) so tab B below can join
        # it and genuinely SHARE localStorage -- same reasoning as
        # test_local_store.py's own two-tabs-one-context setup.
        ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
        ctx.add_init_script(point_at_test_relay)
        # Generous default timeout: reproducing this bug pins the renderer
        # badly enough that even a trivial evaluate("1+1") measured 21s to
        # return in this environment (confirmed while writing this test) --
        # this must be long enough for that to actually finish and let this
        # test's OWN assertions fail with a clear message, rather than
        # Playwright's default 30s timeout firing first with a generic one.
        ctx.set_default_timeout(45000)
        a = ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
        a.click('.view-btn[data-view="admin"]')
        team_link = a.eval_on_selector("#teamLinkInput", "el=>el.value")

        # ============ tab B: same context, same team link ============
        b = ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(team_link, wait_until="domcontentloaded")
        # The bug this test targets can start amplifying the instant tab B
        # connects (tab A's genesis push already sharing localStorage with
        # it) -- severely enough, confirmed while writing this test, that
        # even tab B's OWN first render can take upwards of a minute to
        # complete. A generous but bounded timeout, converted to a clear
        # assertion, so a real regression fails fast-ish with a readable
        # message instead of either hanging or a generic Playwright timeout.
        try:
            b.wait_for_selector('#adminSquadList .admin-squad-name', state="attached", timeout=60000)
        except Exception as e:
            raise AssertionError(
                "tab B never became responsive after connecting alongside tab A -- "
                "this is PERF-1's idle cross-tab sync loop, not a setup problem: " + str(e)
            )
        b.click('.view-btn[data-view="admin"]')

        # ---- install counters as early as possible, right after both tabs
        # are connected -- BEFORE any extended settle window, since the bug
        # this test targets can saturate the renderer badly enough that a
        # later evaluate() call itself takes many seconds to even return
        # (confirmed while writing this test: 21s for a trivial 1+1). ----
        a.evaluate(INSTALL_COUNTERS_JS)
        b.evaluate(INSTALL_COUNTERS_JS)

        # Let the genesis pushes / initial hydrate settle before taking the
        # real baseline -- a fixed settle window, not a causal wait, since
        # "nothing more happens" is exactly the thing under test.
        a.wait_for_timeout(1500)
        baseline_a = a.evaluate(READ_COUNTERS_JS)
        baseline_b = b.evaluate(READ_COUNTERS_JS)
        print("baseline counts after settling -- a:", baseline_a, "b:", baseline_b)

        print("=== idle: two tabs sharing localStorage, both connected, doing nothing ===")
        # Bounded observation window: a real self-sustaining loop cycles on
        # the order of a relay round trip (tens of ms), so 2s of real idle
        # time is enough to separate "genuinely idle" from "runaway loop"
        # without depending on exact timing.
        a.wait_for_timeout(2000)

        # The bug's real symptom (reported: a tab "became unresponsive to
        # browser evaluation") means the evaluate() call below can itself
        # take many seconds to return when the renderer is saturated -- that
        # elapsed time IS a direct, independent measurement of the bug, not
        # just a timeout to tolerate.
        t0 = time.time()
        after_a = a.evaluate(READ_COUNTERS_JS)
        a_evaluate_seconds = time.time() - t0
        t0 = time.time()
        after_b = b.evaluate(READ_COUNTERS_JS)
        b_evaluate_seconds = time.time() - t0
        print("after ~2s idle -- a:", after_a, "(evaluate took %.1fs)" % a_evaluate_seconds,
              " b:", after_b, "(evaluate took %.1fs)" % b_evaluate_seconds)

        assert a_evaluate_seconds < 2.0, \
            "tab A took %.1fs to respond to a trivial evaluate() after idling -- renderer is pinned by a sync loop" % a_evaluate_seconds
        assert b_evaluate_seconds < 2.0, \
            "tab B took %.1fs to respond to a trivial evaluate() after idling -- renderer is pinned by a sync loop" % b_evaluate_seconds
        assert after_a == baseline_a, "tab A kept rendering/pushing/applying while genuinely idle: " + str(after_a)
        assert after_b == baseline_b, "tab B kept rendering/pushing/applying while genuinely idle: " + str(after_b)

        # ---- sanity: the counters are actually wired to something real --
        # a genuine edit must still move them, or the assertion above would
        # be vacuously true. ----
        print("=== a real edit still propagates, live, to the other tab sharing storage ===")
        a.click("#addSquadBtn")
        b.wait_for_function(
            "() => Array.from(document.querySelectorAll('#adminSquadList input.admin-squad-name')).some(i => i.value === 'New squad')"
        )
        after_edit_b = b.evaluate(READ_COUNTERS_JS)
        print("tab B counts after A's edit (must have moved):", after_edit_b)
        assert after_edit_b["renders"] > after_b["renders"], "tab B never rendered A's real edit"

        # And it must settle again, not keep climbing forever once applied.
        settled_b = b.evaluate(READ_COUNTERS_JS)
        b.wait_for_timeout(2000)
        after_settle_b = b.evaluate(READ_COUNTERS_JS)
        print("tab B counts 2s after the edit settled:", after_settle_b)
        assert after_settle_b == settled_b, "tab B kept churning after a single real edit converged: " + str(after_settle_b)

        # ---- the reverse direction, and a THIRD, completely separate
        # browser context (no shared storage at all -- only the relay in
        # common) must both still see it, proving the fix didn't just mute
        # cross-tab sync. ----
        print("=== a real edit also reaches a separate browser context, via the relay ===")
        c_ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
        c_ctx.add_init_script(point_at_test_relay)
        c = c_ctx.new_page()
        c_errors = []
        c.on("pageerror", lambda e: c_errors.append(str(e)))
        c.goto(team_link, wait_until="domcontentloaded")
        c.wait_for_function(
            "() => Array.from(document.querySelectorAll('#adminSquadList input.admin-squad-name')).some(i => i.value === 'New squad')"
        )
        print("separate context C sees A's edit via the relay: OK")

        b.click("#addSquadBtn")
        c.wait_for_function(
            "() => Array.from(document.querySelectorAll('#adminSquadList input.admin-squad-name')).filter(i => i.value === 'New squad').length === 2"
        )
        print("separate context C sees B's edit too: OK")

        # ---- reload + reconnect preserve convergence and data ----
        print("=== reload preserves convergence and data ===")
        a.reload(wait_until="domcontentloaded")
        a.wait_for_selector('.admin-squad-name', state="attached")
        a_names_after_reload = a.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("tab A's board after reload:", a_names_after_reload)
        assert a_names_after_reload.count("New squad") == 2

        print("errors:", a_errors, b_errors, c_errors)
        assert a_errors == [] and b_errors == [] and c_errors == []
        print("PASS")
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
