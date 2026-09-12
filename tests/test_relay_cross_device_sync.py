from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# This is the one test that proves cross-device sync actually works, not
# just "the code looks right": it starts the REAL relay/server.js as a
# subprocess and drives TWO separate, independently-seeded browser contexts
# (their own localStorage, standing in for two different devices/browsers)
# against it over a real WebSocket, through public/local-store.js +
# public/js/relay-client.js + public/js/crypto.js -- no fake store, no
# build_page.py splice (write_plain_index only strips the Google Fonts
# <link> that would otherwise stall every page load -- see its docstring).
# If the facilitator's session card and the participant's join screen
# actually converge on the same live state, the relay, the encryption, and
# the db-shim routing are all doing their job together, end to end.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_relay_sync_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8791
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
        out = relay_proc.stdout.read() if relay_proc.stdout else ""
        raise RuntimeError("relay server never opened port %d\n%s" % (RELAY_PORT, out))

    with sync_playwright() as p:
        browser = p.chromium.launch()

        point_at_test_relay = "window.SQUAD_PULSE_RELAY_URL = %r;" % RELAY_URL

        # ============ facilitator device ============
        facilitator_ctx = browser.new_context(viewport={"width":1280,"height":1200})
        facilitator_ctx.add_init_script(point_at_test_relay)
        fac = facilitator_ctx.new_page()
        fac_errors = []
        fac.on("pageerror", lambda e: fac_errors.append(str(e)))
        fac.goto(INDEX_URL, wait_until="domcontentloaded")
        fac.wait_for_timeout(500)

        fac.click('.view-btn[data-view="squad"]')
        fac.wait_for_timeout(100)
        fac.click('.squad-pick-btn[data-id="squad-1"]')
        fac.wait_for_timeout(150)
        fac.click('#startSessionBtn')
        fac.wait_for_timeout(400)

        code = fac.eval_on_selector('.session-code', 'el=>el.textContent')
        print("=== facilitator started a session ===")
        print("session code:", code)
        assert code and len(code) == 6
        print("errors so far:", fac_errors)

        # ============ participant device: a SEPARATE browser context (own
        # localStorage/board), joining purely by the code, exactly as a
        # teammate on their own laptop would ============
        participant_ctx = browser.new_context(viewport={"width":420,"height":1400})
        participant_ctx.add_init_script(point_at_test_relay)
        team = participant_ctx.new_page()
        team_errors = []
        team.on("pageerror", lambda e: team_errors.append(str(e)))
        team.goto(INDEX_URL, wait_until="domcontentloaded")
        team.wait_for_timeout(400)

        team.click('#joinCodeBtn')
        team.wait_for_timeout(100)
        team.fill('#joinCodeInput', code)
        team.click('#joinCodeGo')
        team.wait_for_timeout(600)

        print("=== participant joined by code, over the real relay ===")
        heading = team.eval_on_selector('#joinCard h2', 'el=>el.textContent')
        print("join screen heading:", heading)
        assert "retro" in heading.lower()
        row_labels = team.eval_on_selector_all('#joinCard .direct-row .stmt-text', 'els=>els.map(e=>e.textContent)')
        print("dimensions the participant can answer (came from the facilitator's own board, over the wire):", row_labels)
        assert len(row_labels) > 0, "the participant should see the real dimensions from squad-1's board, decrypted from the relay"
        print("errors so far:", team_errors)

        # participant answers every dimension: last one red, rest green
        rows = team.query_selector_all('.direct-row')
        for row in rows[:-1]:
            row.query_selector('.swatch.good').click()
            team.wait_for_timeout(20)
        rows[-1].query_selector('.swatch.crit').click()
        team.wait_for_timeout(50)
        assert team.eval_on_selector('#stmtSubmitBtn', 'el=>el.disabled') == False
        team.click('#stmtSubmitBtn')
        team.wait_for_timeout(500)

        print("=== participant sees their own personal results ===")
        pills = team.eval_on_selector_all('.personal-result .pill', 'els=>els.map(e=>e.textContent.trim())')
        print("pills:", pills)
        assert pills.count("Red") == 1
        print("errors:", team_errors)

        # ============ back on the facilitator device: flip to live and see
        # the real submission that just came in over the relay ============
        print("=== facilitator flips to live reveal and sees the real submission ===")
        fac.click('.reveal-btn[data-reveal="live"]')
        fac.wait_for_timeout(600)
        row_texts = fac.eval_on_selector_all('.live-dim-row', 'els=>els.map(e=>e.textContent)')
        print("facilitator's live rows:", row_texts)
        assert len(row_texts) == len(row_labels)
        assert any("Red" in t for t in row_texts), "the participant's one red pick should show up on the facilitator's screen"
        print("errors:", fac_errors)

        print("=== facilitator finishes the retro; results land in their own squad ===")
        fac.click('#finishSessionBtn')
        fac.wait_for_timeout(150)
        fac.click('#confirmOk')
        fac.wait_for_timeout(500)
        assert fac.query_selector('#startSessionBtn') is not None, "the session card should show 'start a new session' again once finished"
        print("errors:", fac_errors)

        print("=== a late-joining THIRD device, after the session already closed, sees it really ended ===")
        # closeSession() writes status:"closed" rather than deleting the doc
        # outright (see retro.js) specifically so this case reads as "ended"
        # rather than the generic "isn't open" a bad/never-existed code
        # gets -- this is the real, honest distinction that's possible
        # without any persistent database (see STATUS.md's locked
        # decisions): the doc still exists for as long as the relay's own
        # room-empty grace period keeps the room alive, which a
        # just-finished session (facilitator's tab, at least, still open a
        # moment ago) comfortably is.
        late_ctx = browser.new_context(viewport={"width":420,"height":900})
        late_ctx.add_init_script(point_at_test_relay)
        late = late_ctx.new_page()
        late_errors = []
        late.on("pageerror", lambda e: late_errors.append(str(e)))
        late.goto(INDEX_URL + "?session=" + code, wait_until="domcontentloaded")
        late.wait_for_timeout(600)
        late_heading = late.eval_on_selector('#joinCard h2', 'el=>el.textContent')
        print("late joiner heading:", late_heading)
        assert "ended" in late_heading.lower()
        print("errors:", late_errors)

        print("=== a device joining a code that never existed at all sees the generic message, not 'ended' ===")
        never_ctx = browser.new_context(viewport={"width":420,"height":900})
        never_ctx.add_init_script(point_at_test_relay)
        never = never_ctx.new_page()
        never_errors = []
        never.on("pageerror", lambda e: never_errors.append(str(e)))
        never.goto(INDEX_URL + "?session=NEVER01", wait_until="domcontentloaded")
        never.wait_for_timeout(600)
        never_heading = never.eval_on_selector('#joinCard h2', 'el=>el.textContent')
        print("never-existed code heading:", never_heading)
        assert "isn" in never_heading.lower() and "open" in never_heading.lower()
        assert "ended" not in never_heading.lower()
        print("errors:", never_errors)

        print("=== ALL ERRORS: facilitator=", fac_errors, "participant=", team_errors, "late=", late_errors)
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
