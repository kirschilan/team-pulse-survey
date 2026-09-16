from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Story 6 of STATUS.md's "Board sync" plan: wire "finish retro" through the
# shared board doc -- the actual fix for the original bug report (Mac
# facilitates squad-1, iOS facilitates squad-2, each device ends up with
# only its OWN half of the picture) and the "co-facilitator finish retro"
# ownership question. "Finish & apply" already writes into the local
# `squads/<id>` doc (squads.js's persistDimensionRatings) -- and that path
# already gets pushed to a connected team's shared board by db.js's squads
# onSnapshot listener (wired in step 3), then picked up live by any other
# device subscribed to that team (step 5). Written BEFORE any new
# production code, per this repo's TDD skill, specifically to find out
# whether steps 1-5 already close this gap or whether real new plumbing is
# needed.
#
# Reproduces the ORIGINAL bug report as closely as this harness allows,
# with one addition: both devices are connected to the same team link.
#   1. Device A creates a team link; device B opens it (both team-synced).
#   2. Device A facilitates a retro for squad-1; device B joins as
#      participant and answers; device A finishes -- squad-1's result
#      should reach device B LIVE, no reload, via the open team subscription.
#   3. Reverse roles: device B facilitates a retro for squad-2; device A
#      joins and answers; device B finishes -- squad-2's result should
#      reach device A LIVE too.
#   4. Both devices now show BOTH squads' real results -- the divergence
#      from the original bug report is gone.
#
# Rainy day: a THIRD device that never connected to the team link (a plain
# session participant, exactly like today's default/disconnected use) must
# NOT receive either squad's board-wide update -- team sync only affects
# devices that opted in, never a bystander session participant.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_finish_retro_convergence_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8792
RELAY_URL = "ws://localhost:%d" % RELAY_PORT


def wait_for_port(port, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def cell_color(page, squad_id, dim_key):
    classes = page.eval_on_selector(
        '.cell-btn[data-squad="%s"][data-dim="%s"]' % (squad_id, dim_key),
        "el => el.className",
    )
    for c in ("good", "warn", "crit", "unscored"):
        if c in classes.split():
            return c
    return None


# Waits for a specific cell to leave the default "unscored" state -- the
# real, causally-correct signal that a team-board push+live-subscribe
# round trip landed, for the exact cell the next assertion is about to
# check (not a generic "wait for everything to settle" guess). Only valid
# where the test already expects that cell to become scored; a rainy-day
# check expecting a cell to STAY unscored must keep using a plain wait.
def wait_for_scored(page, squad_id, dim_key, timeout=5000):
    page.wait_for_function(
        '() => { var el = document.querySelector(\'.cell-btn[data-squad="%s"][data-dim="%s"]\'); return el && el.className.indexOf("unscored") === -1; }' % (squad_id, dim_key),
        timeout=timeout,
    )


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
        # Must kill the process (closing its stdout) BEFORE reading it --
        # .read() blocks until EOF, and a relay that's still alive (just
        # slow to bind, e.g. under CPU contention from parallel test jobs)
        # never sends EOF, so this used to deadlock the whole suite instead
        # of raising the intended error. Found via a real hang in CI/local
        # runs: this exact test process stuck for 50+ minutes.
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

        # ============ device A connects, creates the team link ============
        a_ctx = browser.new_context(viewport={"width": 1280, "height": 1200})
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.click('.view-btn[data-view="admin"]')
        # step 7: default-on -- device A auto-generates its own team secret at
        # boot via crypto.subtle (a real, non-instant async API, unlike this
        # fake store's near-instant local writes) -- poll for the real value
        # landing instead of guessing how long key generation takes.
        a.wait_for_function("() => document.getElementById('teamLinkInput') && document.getElementById('teamLinkInput').value.length > 0")
        team_link = a.eval_on_selector("#teamLinkInput", "el=>el.value")

        # ============ device B opens the same team link ============
        b_ctx = browser.new_context(viewport={"width": 420, "height": 1400})
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(team_link, wait_until="domcontentloaded")
        # No documented DOM signal exists for "this device finished adopting
        # a team it just opened via URL" (distinct from any particular
        # write landing) -- same precedent as test_cofacilitator_join.py's
        # identical moment. Getting this wrong on a relay-backed,
        # cross-device path risks a worse, harder-to-diagnose failure than
        # the modest time this costs, so it stays a plain wait.
        b.wait_for_timeout(500)

        print("=== round 1: device A facilitates squad-1, device B answers ===")
        a.click('.view-btn[data-view="squad"]')
        a.click('.squad-pick-btn[data-id="squad-1"]')
        a.click("#startSessionBtn")
        # real relay round trip (generateSecret()/roomIdFor() are real
        # crypto.subtle calls too) -- wait for it, don't guess how long.
        a.wait_for_function("() => document.getElementById('sessionJoinLink') && document.getElementById('sessionJoinLink').value.length > 0")
        join_link1 = a.eval_on_selector("#sessionJoinLink", "el=>el.value")
        print("session 1 join link:", join_link1)

        # SEC-2: co-facilitating/joining is only ever reachable by opening
        # the real link now (no typed-code modal) -- device B is already
        # team-synced, and join_link1 carries device A's team secret too, so
        # this one navigation both re-confirms the team and joins the session.
        #
        # Codex review on PR #14 (P1): join_link1 and device B's CURRENT
        # document (team_link, just above) share the same URL apart from
        # their fragment (#session=...&team=... vs #team=...) -- a plain
        # goto() between two URLs that differ only by fragment is a same-
        # document "fragment navigation" per the HTML spec (true in every
        # real browser, not a Playwright quirk), so it would never actually
        # reload/rerun the app's boot-time fragment parsing. An intermediate
        # about:blank forces the real, full navigation this scenario means
        # to exercise.
        b.goto("about:blank")
        b.goto(join_link1, wait_until="domcontentloaded")
        b.wait_for_selector(".direct-row")  # real relay round trip -- wait for it, don't guess how long
        rows = b.query_selector_all(".direct-row")
        assert len(rows) > 0, "device B should see squad-1's real dimensions over the relay"
        # Every step here is click() -- Playwright auto-waits for each target
        # to become actionable, and joinDraftAnswers/refreshSubmitEnabled()
        # (retro-join.js) update synchronously in the click handler, so the
        # loop needs no waits of its own.
        for row in rows[:-1]:
            row.query_selector(".swatch.good").click()
        rows[-1].query_selector(".swatch.crit").click()
        b.click("#stmtSubmitBtn")
        # .add() is a REAL relay round trip (this file's own db, not a fake
        # store) that only resolves once the relay acks the write -- and
        # afterSubmit() (retro-join.js) only re-renders the personal-result
        # page once that resolves. Waiting for it is what actually
        # guarantees the submission landed before navigating away below,
        # not just a guess at how long the round trip takes.
        b.wait_for_selector('.personal-result', state="attached")

        # Device B is a join-mode page now (no nav back to the main app --
        # that's the real, current gap story 9 is about) -- navigating back
        # to the plain URL is exactly what the ORIGINAL bug report's repro
        # steps did too ("*refreshed page on iOS*; iOS now goes to main
        # page"). Team sync survives this since the secret is in localStorage,
        # not the URL that just got left behind.
        b.goto(INDEX_URL, wait_until="domcontentloaded")
        # .squad-pick-btn is rendered from state.squads, not static HTML --
        # its existence is the real post-reload boot marker, not a guess
        b.wait_for_selector('.squad-pick-btn[data-id="squad-1"]', state="attached")

        # setRevealMode()'s live-mode write is a REAL relay round trip that
        # this device's own UI only reflects once its session listener
        # receives it back (unlike the local liveOr() fallback, it doesn't
        # optimistically re-render) -- the toggle gaining "active" is that
        # real signal, not a guess at round-trip time.
        a.click('.reveal-btn[data-reveal="live"]')
        a.wait_for_selector('.reveal-btn[data-reveal="live"].active', state="attached")
        a.click("#finishSessionBtn")
        a.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
        a.click("#confirmOk")
        print("=== device A finished squad-1's retro -- checking device A's own board ===")
        a.click('.squad-pick-btn[data-id="squad-1"]')
        wait_for_scored(a, "squad-1", "release")  # real relay round trip -- wait for it, don't guess how long
        a_squad1_release = cell_color(a, "squad-1", "release")
        print("device A, squad-1/release:", a_squad1_release)
        assert a_squad1_release in ("good", "warn", "crit")

        print("=== does device B see squad-1's finished result LIVE, via its open subscription (no SECOND reload)? ===")
        b.click('.view-btn[data-view="squad"]')
        b.click('.squad-pick-btn[data-id="squad-1"]')
        wait_for_scored(b, "squad-1", "release")  # real relay round trip -- wait for it, don't guess how long
        b_squad1_release = cell_color(b, "squad-1", "release")
        print("device B, squad-1/release (live, no second reload):", b_squad1_release)
        assert b_squad1_release == a_squad1_release, "device B should see the SAME finished result A just applied, live, via the shared team board -- this is the actual fix for the original divergence bug"

        print("=== round 2: reverse roles -- device B facilitates squad-2, device A answers ===")
        b.click('.squad-pick-btn[data-id="squad-2"]')
        b.click("#startSessionBtn")
        b.wait_for_function("() => document.getElementById('sessionJoinLink') && document.getElementById('sessionJoinLink').value.length > 0")
        join_link2 = b.eval_on_selector("#sessionJoinLink", "el=>el.value")
        print("session 2 join link:", join_link2)
        assert join_link2 != join_link1

        # Codex review on PR #14 (P1): same fragment-only-navigation issue as
        # round 1's identical b.goto(join_link1) above -- device A's current
        # document (INDEX_URL, no fragment) and join_link2 share the same
        # URL apart from the fragment, so this needs the same about:blank
        # step to force a real reload.
        a.goto("about:blank")
        a.goto(join_link2, wait_until="domcontentloaded")
        a.wait_for_selector(".direct-row")  # real relay round trip -- wait for it, don't guess how long
        rows2 = a.query_selector_all(".direct-row")
        assert len(rows2) > 0, "device A should see squad-2's real dimensions over the relay"
        for row in rows2[:-1]:
            row.query_selector(".swatch.good").click()
        rows2[-1].query_selector(".swatch.warn").click()
        a.click("#stmtSubmitBtn")
        # See round 1's identical wait above -- .add() only resolves once
        # the relay acks the write, and that's what this waits for.
        a.wait_for_selector('.personal-result', state="attached")
        # Same as device B in round 1 -- device A is stuck on the join
        # screen with no nav back (the real gap story 9 addresses), so
        # leave join mode the same way a real user would today: navigate
        # back to the plain URL. Team sync survives it (localStorage).
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_selector('.squad-pick-btn[data-id="squad-1"]', state="attached")  # real post-reload boot marker, not a guess

        # Same real signal as round 1's identical moment above.
        b.click('.reveal-btn[data-reveal="live"]')
        b.wait_for_selector('.reveal-btn[data-reveal="live"].active', state="attached")
        b.click("#finishSessionBtn")
        b.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
        b.click("#confirmOk")
        b.click('.squad-pick-btn[data-id="squad-2"]')
        wait_for_scored(b, "squad-2", "release")  # real relay round trip -- wait for it, don't guess how long
        b_squad2_release = cell_color(b, "squad-2", "release")
        print("device B (facilitator), squad-2/release:", b_squad2_release)
        assert b_squad2_release in ("good", "warn", "crit")

        print("=== does device A see squad-2's finished result LIVE too (no second reload)? ===")
        a.click('.view-btn[data-view="squad"]')
        a.click('.squad-pick-btn[data-id="squad-2"]')
        wait_for_scored(a, "squad-2", "release")  # real relay round trip -- wait for it, don't guess how long
        a_squad2_release = cell_color(a, "squad-2", "release")
        print("device A, squad-2/release (no reload):", a_squad2_release)
        assert a_squad2_release == b_squad2_release

        print("=== the divergence from the original bug report is gone: BOTH devices show BOTH squads ===")
        # Both squads' data is already confirmed landed above -- these are
        # just re-checks after switching the LOCAL squad selection, a
        # synchronous client-side re-render, not a new relay round trip.
        # eval_on_selector() (inside cell_color()) doesn't auto-wait, so
        # wait for the specific cell to be attached after each switch,
        # rather than guess how long the re-render takes.
        a.click('.squad-pick-btn[data-id="squad-1"]')
        a.wait_for_selector('.cell-btn[data-squad="squad-1"][data-dim="release"]', state="attached")
        assert cell_color(a, "squad-1", "release") == a_squad1_release, "device A still has its own squad-1 result"
        b.click('.squad-pick-btn[data-id="squad-1"]')
        b.wait_for_selector('.cell-btn[data-squad="squad-1"][data-dim="release"]', state="attached")
        assert cell_color(b, "squad-1", "release") == a_squad1_release, "device B ALSO has squad-1's result (this is the fix)"
        a.click('.squad-pick-btn[data-id="squad-2"]')
        a.wait_for_selector('.cell-btn[data-squad="squad-2"][data-dim="release"]', state="attached")
        assert cell_color(a, "squad-2", "release") == b_squad2_release, "device A ALSO has squad-2's result (this is the fix)"

        print("=== RAINY DAY: a third device, never opened A/B's team link, is unaffected by any of this ===")
        c_ctx = browser.new_context(viewport={"width": 420, "height": 900})
        c_ctx.add_init_script(point_at_test_relay)
        c = c_ctx.new_page()
        c_errors = []
        c.on("pageerror", lambda e: c_errors.append(str(e)))
        c.goto(INDEX_URL, wait_until="domcontentloaded")  # plain URL, NOT the team link
        c.click('.view-btn[data-view="admin"]')
        # Same real signal as device A's identical moment above (step 7's
        # crypto.subtle-backed key generation).
        c.wait_for_function("() => document.getElementById('teamLinkInput') && document.getElementById('teamLinkInput').value.length > 0")
        # Step 7: default-on means device C isn't "not connected" any more --
        # it auto-generated its OWN random team secret at boot, same as A and
        # B did. The real rainy-day invariant is that C's team link is its
        # OWN, distinct from A/B's -- proving it's a genuinely separate team,
        # not somehow onto the same one -- so it never sees A/B's board.
        c_link = c.eval_on_selector("#teamLinkInput", "el=>el.value")
        print("device C's own (different) team link:", c_link)
        assert c_link and c_link != team_link
        c.click('.view-btn[data-view="squad"]')
        c.click('.squad-pick-btn[data-id="squad-1"]')
        # wait_for_scored() can't be used here -- this cell is EXPECTED to
        # stay unscored (that's the whole point of this rainy-day check), so
        # polling for it to leave "unscored" would just waste the full
        # timeout waiting for something that must never happen. There's no
        # positive DOM signal for "nothing arrived, and nothing ever will",
        # so this stays a plain wait -- the margin the rest of this file
        # already trusts real relay round trips to land well within.
        c.wait_for_timeout(150)
        c_squad1_release = cell_color(c, "squad-1", "release")
        print("device C (never team-synced), squad-1/release:", c_squad1_release)
        assert c_squad1_release == "unscored", "a device that never connected to the team link must not receive board-wide updates from it"

        print("=== ALL ERRORS: a=", a_errors, "b=", b_errors, "c=", c_errors)
        assert a_errors == [] and b_errors == [] and c_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
