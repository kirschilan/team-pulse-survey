from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Bug report (real 3-device test: Mac facilitator, iPhone + iPad
# participants, both joining via the retro session's OWN join link/QR,
# never the team link): the facilitator's finished retro never reached the
# participants' boards, and a squad rename on one participant's device
# never reached anyone else. Root cause, confirmed by diagnostics: all
# three devices showed DIFFERENT board-sync room ids -- each was on its
# own separate, unrelated default team (board sync step 7's per-device
# auto-generated secret), since joinUrlFor()'s link only ever carried
# `?session=<code>`, never the facilitator's team secret.
#
# Fix, per the product owner's own framing (matching the Excalidraw model
# this repo's docs already reference): a retro session's join link now
# ALSO carries the facilitator's current team secret, so opening it both
# joins that one retro AND switches this device onto the facilitator's
# team -- one link, one shared board, same as opening the team link
# directly would. autoConnectFromLink() (board-sync.js) already applies a
# `?team=` param generically and strips it from the visible URL; nothing
# else needed to change for a joining device to end up team-synced.
#
# Happy path: a device that NEVER opens the team link, only ever the
# session's own join link, still ends up on the facilitator's team --
# sees their real board, and a change made on either device reaches the
# other, live.
# Rainy day: a facilitator who explicitly stopped syncing before starting
# a session must NOT have their old/absent secret force a team onto
# participants -- the join link stays session-only, exactly like before
# this fix, and the joining device keeps its own separate default team.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_retro_join_link_team_sync_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8789
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

        # ============ HAPPY PATH ============
        # ============ device A: facilitator, default team already on (step 7) ============
        a_ctx = browser.new_context(viewport={"width": 1280, "height": 1200})
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_timeout(300)

        print("=== device A renames squad-1 BEFORE anyone joins, so a real, distinctive board exists to sync ===")
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_timeout(100)
        team_link = a.eval_on_selector("#teamLinkInput", "el=>el.value")
        a_secret = a.evaluate("localStorage.getItem('squadpulse:teamSecret')")
        name_input = a.query_selector('.admin-squad-name[data-id="squad-1"]')
        name_input.fill("Renamed By A")
        name_input.dispatch_event("change")
        a.wait_for_timeout(400)

        a.click('.view-btn[data-view="squad"]')
        a.wait_for_timeout(100)
        a.click('.squad-pick-btn[data-id="squad-1"]')
        a.wait_for_timeout(150)
        a.click("#startSessionBtn")
        a.wait_for_selector(".session-code")
        code = a.eval_on_selector(".session-code", "el=>el.textContent")
        join_link = a.eval_on_selector("#sessionJoinLink", "el=>el.value")
        print("session code:", code)
        print("join link:", join_link)

        print("=== the join link carries the facilitator's OWN team secret, distinct from the plain team link ===")
        assert "?session=" + code in join_link
        assert "team=" + a_secret in join_link, "the join link should carry the facilitator's current team secret"
        assert join_link != team_link, "the join link and the plain team link are not the same URL"

        # ============ device B: NEVER opens the team link -- only the session's join link ============
        b_ctx = browser.new_context(viewport={"width": 420, "height": 1400})
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(join_link, wait_until="domcontentloaded")
        b.wait_for_timeout(600)

        print("=== device B never opened the team link, but ended up on device A's team anyway ===")
        b_secret = b.evaluate("localStorage.getItem('squadpulse:teamSecret')")
        print("device A's secret:", a_secret)
        print("device B's secret after opening only the join link:", b_secret)
        assert b_secret == a_secret, "opening the retro's join link should adopt the facilitator's team secret"
        assert "?team=" not in b.url, "the secret should be stripped from the visible URL, same as opening a team link directly"
        assert "?session=" in b.url, "the session param must survive -- device B still needs to join THIS retro"

        print("=== device B's local board already reflects device A's real board, not a fresh default one ===")
        b_squad1_name = b.evaluate("(state.squads.find(s=>s.id==='squad-1')||{}).name")
        print("device B's squad-1 name:", b_squad1_name)
        assert b_squad1_name == "Renamed By A"

        print("=== device B still joins and answers the specific retro normally ===")
        assert b.eval_on_selector("#viewJoin", "el=>el.hidden") is False
        rows = b.query_selector_all(".direct-row")
        assert len(rows) > 0, "device B should see squad-1's real dimensions"
        for row in rows[:-1]:
            row.query_selector(".swatch.good").click()
            b.wait_for_timeout(20)
        rows[-1].query_selector(".swatch.crit").click()
        b.wait_for_timeout(50)
        b.click("#stmtSubmitBtn")
        b.wait_for_timeout(400)
        assert b.query_selector(".personal-result") is not None

        print("=== the reverse direction also works: device B renames a DIFFERENT squad, device A sees it live ===")
        b.evaluate("""() => {
          window.__joinSecretForLaterAdmin = localStorage.getItem('squadpulse:teamSecret');
        }""")
        # B is still on the participant join screen (no nav back needed for
        # this check) -- board-sync runs regardless of join mode, so B's own
        # local squads write below still reaches the relay.
        b.evaluate("""() => {
          return window.claude.use('db').then(db => db.collection('squads').doc('squad-2').update({ name: 'Renamed By B' }));
        }""")
        a.wait_for_timeout(700)
        a_squad2_name = a.evaluate("(state.squads.find(s=>s.id==='squad-2')||{}).name")
        print("device A's squad-2 name after device B's rename:", a_squad2_name)
        assert a_squad2_name == "Renamed By B", "a change from the join-link device should reach the facilitator too, live"

        print("=== ALL ERRORS (happy path): a=", a_errors, "b=", b_errors)
        assert a_errors == [] and b_errors == []

        # ============ RAINY DAY: a facilitator who stopped syncing produces a plain, session-only link ============
        print("=== RAINY DAY: device A stops syncing, then starts a NEW session -- its join link must NOT carry a team ===")
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_timeout(100)
        a.click("#teamDisconnectBtn")
        a.wait_for_timeout(150)
        assert a.evaluate("localStorage.getItem('squadpulse:teamSecret')") in (None, "")

        a.click('.view-btn[data-view="squad"]')
        a.wait_for_timeout(100)
        a.click('.squad-pick-btn[data-id="squad-3"]')
        a.wait_for_timeout(150)
        a.click("#startSessionBtn")
        a.wait_for_selector(".session-code")
        code2 = a.eval_on_selector(".session-code", "el=>el.textContent")
        join_link2 = a.eval_on_selector("#sessionJoinLink", "el=>el.value")
        print("disconnected facilitator's join link:", join_link2)
        assert "?session=" + code2 in join_link2
        assert "team=" not in join_link2, "no team secret to carry -- must not force one onto a joining device"

        c_ctx = browser.new_context(viewport={"width": 420, "height": 1400})
        c_ctx.add_init_script(point_at_test_relay)
        c = c_ctx.new_page()
        c_errors = []
        c.on("pageerror", lambda e: c_errors.append(str(e)))
        c.goto(join_link2, wait_until="domcontentloaded")
        c.wait_for_timeout(500)
        c_secret = c.evaluate("localStorage.getItem('squadpulse:teamSecret')")
        print("device C's own (untouched, default) secret:", c_secret)
        assert c_secret and c_secret != a_secret and c_secret != b_secret, "device C should keep its own separate default team, unaffected"
        assert c.eval_on_selector("#viewJoin", "el=>el.hidden") is False, "device C should still join the session normally"

        print("=== ALL ERRORS (rainy day): a=", a_errors, "c=", c_errors)
        assert a_errors == [] and c_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
