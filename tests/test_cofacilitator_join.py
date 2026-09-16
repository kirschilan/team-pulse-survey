from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
from urllib.parse import urlparse, parse_qs
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Story 10: a co-facilitator joins an already-open retro session via a
# barcode/link, getting the FULL facilitator view (live tally, reveal,
# override, finish) rather than the participant survey retro-join.js
# already handles. Unlike joining as a participant, this doesn't answer
# anything -- it just needs this device to "know about" the session's
# secret (see relay-client.js's rememberCode()) so the existing broad
# `sessions` listener (already running for every non-join-mode device)
# picks it up. openSessionForSquad() never checks who started a session,
# only whether state.sessions has a matching open one for the squad being
# viewed -- so once a device knows the secret, Squad view renders the
# identical facilitator card any device sees for a session it started
# itself. SEC-2: co-facilitating is now ONLY reachable by opening the real
# co-facilitate link/QR (no typed-code modal any more), so every scenario
# below does exactly that.
#
# Both devices are team-synced (board sync, steps 1-6) so the co-facilitator
# actually has the right squad locally and "Finish & apply" lands in the
# SAME shared board -- this is the realistic setup for co-facilitation to
# make sense at all.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_cofacilitator_join_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8790
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
# check (not a generic "wait for everything to settle" guess).
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

        # ============ device A: creates the team link, starts a retro ============
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

        a.click('.view-btn[data-view="squad"]')
        a.click('.squad-pick-btn[data-id="squad-1"]')
        a.click("#startSessionBtn")
        # real relay round trip (generateSecret()/roomIdFor() are both real
        # crypto.subtle calls too, not instant) -- wait for it, don't guess.
        a.wait_for_function("() => document.getElementById('sessionJoinLink') && document.getElementById('sessionJoinLink').value.length > 0")

        print("=== device A's session card offers a REAL co-facilitator link/QR, distinct from the participant join link ===")
        cofac_link = a.eval_on_selector("#coFacilitateLink", "el=>el.value")
        join_link = a.eval_on_selector("#sessionJoinLink", "el=>el.value")
        print("co-facilitator link:", cofac_link)
        print("participant join link:", join_link)
        secret = parse_qs(urlparse(join_link).query)["session"][0]
        cofac_secret = parse_qs(urlparse(cofac_link).query)["cofacilitate"][0]
        assert cofac_secret == secret, "the join and co-facilitate links carry the SAME session secret, just under different params"
        assert cofac_link != join_link
        assert a.eval_on_selector("#coFacilitateQr svg", "el=>!!el") is True, "a QR code should render for the co-facilitator link too"

        print("=== a device that OPENS that real link directly (the only way to co-facilitate now -- SEC-2) also lands as co-facilitator ===")
        d_ctx = browser.new_context(viewport={"width": 1280, "height": 1200})
        d_ctx.add_init_script(point_at_test_relay)
        d = d_ctx.new_page()
        d_errors = []
        d.on("pageerror", lambda e: d_errors.append(str(e)))
        d.goto(cofac_link, wait_until="domcontentloaded")
        # eval_on_selector()/query_selector() below don't auto-wait -- wait
        # for the exact element the scenario is about (the session card
        # landing) rather than guess how long boot + join take.
        d.wait_for_selector(".session-card", state="attached")
        print("device D (opened the link directly) is on Squad view, not the join screen:", d.eval_on_selector("#viewJoin", "el=>el.hidden"))
        assert d.eval_on_selector("#viewJoin", "el=>el.hidden") is True
        assert d.eval_on_selector("#viewSquad", "el=>el.hidden") is False
        assert d.query_selector(".session-card") is not None, "opening the co-facilitator link directly should show the facilitator session card"
        print("errors:", d_errors)
        assert d_errors == []

        # ============ device C: opens the team link, joins as a PARTICIPANT and answers ============
        c_ctx = browser.new_context(viewport={"width": 420, "height": 1400})
        c_ctx.add_init_script(point_at_test_relay)
        c = c_ctx.new_page()
        c_errors = []
        c.on("pageerror", lambda e: c_errors.append(str(e)))
        # join_link already carries device A's team secret too (see
        # helpers.js's joinUrlFor()/teamParamFor()), so one navigation does
        # what visiting the team link then typing a code used to take two
        # steps to do.
        c.goto(join_link, wait_until="domcontentloaded")
        c.wait_for_selector(".direct-row")  # real relay round trip -- wait for it, don't guess how long
        rows = c.query_selector_all(".direct-row")
        assert len(rows) > 0
        for row in rows[:-1]:
            row.query_selector(".swatch.good").click()
        rows[-1].query_selector(".swatch.crit").click()
        c.click("#stmtSubmitBtn")

        # ============ device B: opens a co-facilitate link (bad, then real)
        # -- never started this session ============
        # SEC-2: co-facilitating is only ever reachable by a link now, so the
        # rainy-day case below is a link carrying a wrong/nonexistent secret,
        # not a typo in a modal's input. It's built from the REAL cofac_link
        # so it still carries device A's real team secret (a co-facilitator
        # needs the shared team board regardless of whether the session
        # secret itself is any good) -- only the session secret is wrong.
        bad_cofac_link = cofac_link.replace("cofacilitate=" + cofac_secret, "cofacilitate=ZZZZZZ-bad-session-secret")
        b_ctx = browser.new_context(viewport={"width": 1280, "height": 1200})
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))

        print("=== RAINY DAY: co-facilitating with a wrong/nonexistent secret shows an error, not a crash ===")
        b.goto(bad_cofac_link, wait_until="domcontentloaded")
        b.wait_for_selector("#confirmBackdrop", state="visible")  # real relay round trip -- wait for it, don't guess how long
        error_shown = b.query_selector("#confirmBackdrop") is not None and b.eval_on_selector("#confirmBackdrop", "el=>!el.hidden")
        print("error dialog shown for a bad secret:", error_shown)
        assert error_shown
        b.click("#confirmOk")
        print("errors so far:", b_errors)

        print("=== HAPPY PATH: device B co-facilitates the REAL open session by its real link ===")
        b.goto(cofac_link, wait_until="domcontentloaded")
        b.wait_for_selector(".session-card")  # real relay round trip -- wait for it, don't guess how long

        print("device B should be on the normal board, Squad view, squad-1 selected -- NOT the participant join screen")
        assert b.eval_on_selector("#viewJoin", "el=>el.hidden") is True
        assert b.eval_on_selector("#viewSquad", "el=>el.hidden") is False
        assert b.eval_on_selector(".view-switch", "el=>el.hidden") is False
        session_card = b.query_selector(".session-card")
        print("session card present on device B (never started this session):", session_card is not None)
        assert session_card is not None
        finish_btn_visible = b.query_selector("#finishSessionBtn") is not None
        print("finish button available to the co-facilitator:", finish_btn_visible)

        print("=== device B (co-facilitator) sees the real live tally from device C's answer ===")
        b.click('.reveal-btn[data-reveal="live"]')
        # real relay round trip (device C's earlier submission reaching this
        # device) -- poll for the exact expected content instead of guessing
        # how long it takes, the same condition asserted right below.
        b.wait_for_function("() => Array.from(document.querySelectorAll('.live-dim-row')).some(el => el.textContent.indexOf('Red') !== -1)")
        row_texts = b.eval_on_selector_all(".live-dim-row", "els=>els.map(e=>e.textContent)")
        print("live rows on the co-facilitator's device:", row_texts)
        assert any("Red" in t for t in row_texts), "the co-facilitator should see the real submission, not an empty tally"
        print("errors so far:", b_errors)

        print("=== device B finishes the retro it never started ===")
        b.click("#finishSessionBtn")
        b.click("#confirmOk")
        wait_for_scored(b, "squad-1", "release")
        b_release = cell_color(b, "squad-1", "release")
        print("device B's own squad-1/release after finishing:", b_release)
        assert b_release in ("good", "warn", "crit")

        print("=== the ORIGINATING facilitator (device A) sees the co-facilitator's finish, live, via the shared team board ===")
        wait_for_scored(a, "squad-1", "release")  # real relay round trip -- wait for it, don't guess how long
        a_release = cell_color(a, "squad-1", "release")
        print("device A's squad-1/release (never clicked finish itself):", a_release)
        assert a_release == b_release, "a co-facilitator's finish must reach the session's originating device too, via team sync"

        print("=== ALL ERRORS: a=", a_errors, "b=", b_errors, "c=", c_errors)
        assert a_errors == [] and b_errors == [] and c_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
