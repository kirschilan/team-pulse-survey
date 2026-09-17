from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Codex review on PR #21 (RETRO-1, P1 blocker): applyRemoteBoardSnapshot()
# (board-sync.js) rewrites each local squad doc from a remote team-sync
# snapshot using only name/order/dimensions/updatedAt -- RETRO-1's new
# `lastRetro` field (see finishRetroAndApply(), retro-facilitator.js;
# db.js's squads listener already carries it INTO state, per db.js:66)
# never reaches that rewrite, so any device that receives a remote board
# through team sync silently drops the field from its own local squad doc.
# Worse: db.js's squads onSnapshot listener pushes a fresh board snapshot on
# ANY local squad write (pushBoardSnapshotIfConnected(), wired for every
# device by step 7's default-on team sync) -- so once one device's local
# copy is stripped, its own NEXT unrelated edit echoes the stripped squad
# straight back out and overwrites the ORIGINATING device's copy too,
# permanently losing the result everywhere.
#
# This reproduces exactly the scenario the review asked for: finish -> sync
# -> teammate edit -> reload -> export.
#   1. Device A finishes squad-1's retro (writes lastRetro).
#   2. Device B, team-synced, receives it live via team sync -- must ALSO
#      carry lastRetro on its own local squad-1 doc, not just the ratings.
#   3. Device B makes an unrelated edit (renames squad-2) -- this re-pushes
#      B's whole board, including its own copy of squad-1.
#   4. Device A, receiving B's echo live, must STILL have squad-1's
#      lastRetro afterwards -- proving B's re-push didn't carry a stripped
#      copy back out and overwrite A's own original.
#   5. A real page reload on device A confirms lastRetro survived in
#      actual persisted storage, not just in-memory state.
#   6. A JSON export from device A confirms lastRetro is still exportable
#      after the whole round trip.
#
# Written BEFORE the fix, per this repo's TDD skill -- expected to fail at
# step 2 against the current code (board-sync.js's applyRemoteBoardSnapshot()
# omits lastRetro from the payload it writes).

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_last_retro_preserved_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8806
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


# Same real-relay-round-trip signal as test_board_sync_finish_retro_convergence.py.
def wait_for_scored(page, squad_id, dim_key, timeout=5000):
    page.wait_for_function(
        '() => { var el = document.querySelector(\'.cell-btn[data-squad="%s"][data-dim="%s"]\'); return el && el.className.indexOf("unscored") === -1; }' % (squad_id, dim_key),
        timeout=timeout,
    )


def local_squad_last_retro(page, squad_id):
    return page.evaluate(
        "(id) => { var sq = (window.state.squads || []).filter(s => s.id === id)[0]; return sq ? sq.lastRetro : undefined; }",
        squad_id,
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

        print("=== device A connects, creates the team link ===")
        a_ctx = browser.new_context(viewport={"width": 1280, "height": 1200})
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_function("() => document.getElementById('teamLinkInput') && document.getElementById('teamLinkInput').value.length > 0")
        team_link = a.eval_on_selector("#teamLinkInput", "el=>el.value")

        print("=== device B opens the same team link ===")
        b_ctx = browser.new_context(viewport={"width": 420, "height": 1400})
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(team_link, wait_until="domcontentloaded")
        b.wait_for_timeout(500)  # no documented "team adopted" DOM signal -- same precedent as sibling team-sync tests

        print("=== device A facilitates squad-1's retro, device B answers, A finishes ===")
        a.click('.view-btn[data-view="squad"]')
        a.click('.squad-pick-btn[data-id="squad-1"]')
        a.click("#startSessionBtn")
        a.wait_for_function("() => document.getElementById('sessionJoinLink') && document.getElementById('sessionJoinLink').value.length > 0")
        join_link1 = a.eval_on_selector("#sessionJoinLink", "el=>el.value")

        b.goto("about:blank")
        b.goto(join_link1, wait_until="domcontentloaded")
        b.wait_for_selector(".direct-row")
        rows = b.query_selector_all(".direct-row")
        assert len(rows) > 0
        for row in rows[:-1]:
            row.query_selector(".swatch.good").click()
        rows[-1].query_selector(".swatch.crit").click()
        b.click("#stmtSubmitBtn")
        b.wait_for_selector('.personal-result', state="attached")

        b.goto(INDEX_URL, wait_until="domcontentloaded")
        b.wait_for_selector('.squad-pick-btn[data-id="squad-1"]', state="attached")

        a.click('.reveal-btn[data-reveal="live"]')
        a.wait_for_selector('.reveal-btn[data-reveal="live"].active', state="attached")
        a.click("#finishSessionBtn")
        a.wait_for_selector('#confirmBackdrop', state="visible")
        a.click("#confirmOk")
        a.click('.squad-pick-btn[data-id="squad-1"]')
        wait_for_scored(a, "squad-1", "release")
        a_last_retro = local_squad_last_retro(a, "squad-1")
        print("device A, squad-1 lastRetro right after finishing:", a_last_retro)
        assert a_last_retro is not None and a_last_retro.get("finishedAt"), "finishing a retro must write lastRetro locally (this is the pre-existing RETRO-1 behavior, unaffected by this bug)"

        print("=== does device B's OWN local squad-1 doc carry lastRetro after receiving it via team sync? ===")
        b.click('.view-btn[data-view="squad"]')
        b.click('.squad-pick-btn[data-id="squad-1"]')
        wait_for_scored(b, "squad-1", "release")  # real relay round trip -- proves the ratings half of the snapshot landed
        b_last_retro = local_squad_last_retro(b, "squad-1")
        print("device B, squad-1 lastRetro after live team sync:", b_last_retro)
        assert b_last_retro is not None, (
            "applyRemoteBoardSnapshot() must preserve a cloned lastRetro when writing a remote squad "
            "locally -- device B received squad-1's ratings but not its lastRetro snapshot"
        )
        assert b_last_retro.get("finishedAt") == a_last_retro.get("finishedAt")
        assert b_last_retro.get("dimensions", {}).get("release") == a_last_retro.get("dimensions", {}).get("release")

        print("=== device B makes an UNRELATED edit (renames squad-2) -- this re-pushes B's whole board ===")
        b.click('.view-btn[data-view="admin"]')
        b.wait_for_selector('.admin-squad-name[data-id="squad-2"]')
        b.fill('.admin-squad-name[data-id="squad-2"]', "Squad Two Renamed")
        b.dispatch_event('.admin-squad-name[data-id="squad-2"]', "change")

        print("=== device A, receiving B's echo live, must STILL have squad-1's lastRetro ===")
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_function(
            "() => (window.state.squads || []).some(s => s.id === 'squad-2' && s.name === 'Squad Two Renamed')",
            timeout=5000,
        )  # real relay round trip -- proves B's re-push landed on A
        a_last_retro_after_echo = local_squad_last_retro(a, "squad-1")
        print("device A, squad-1 lastRetro after B's unrelated-edit echo:", a_last_retro_after_echo)
        assert a_last_retro_after_echo is not None, (
            "a teammate's unrelated edit must never erase THIS device's own lastRetro -- "
            "if B's local copy was stripped on receipt, B's next push carries the stripped copy back to A"
        )
        assert a_last_retro_after_echo.get("finishedAt") == a_last_retro.get("finishedAt")

        print("=== a real page reload on device A confirms lastRetro survived in actual persisted storage ===")
        a.reload(wait_until="domcontentloaded")
        a.wait_for_selector('.admin-squad-name[data-id="squad-1"]', state="attached")
        a_last_retro_after_reload = local_squad_last_retro(a, "squad-1")
        print("device A, squad-1 lastRetro after reload:", a_last_retro_after_reload)
        assert a_last_retro_after_reload is not None and a_last_retro_after_reload.get("finishedAt") == a_last_retro.get("finishedAt")

        print("=== JSON export from device A still carries squad-1's lastRetro ===")
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_selector('#exportJsonBtn', state="visible")
        # This page runs on real local-store.js (not fake_store.html), whose
        # own window.claude.use("downloads") shim triggers a REAL browser
        # download (see local-store.js's triggerBrowserDownload()) rather
        # than the window.open() popup fallback other export tests (built on
        # build_page()'s fake store, which leaves "downloads" unimplemented)
        # get -- so this needs expect_download(), not expect_popup().
        with a.expect_download() as dl_info:
            a.click('#exportJsonBtn')
        download = dl_info.value
        json_text = pathlib.Path(download.path()).read_text()
        exported = json.loads(json_text)
        squad1_export = [s for s in exported["squads"] if s["name"] == "Squad 1"][0]
        print("exported squad-1 lastRetro:", squad1_export.get("lastRetro"))
        assert squad1_export.get("lastRetro") is not None
        assert squad1_export["lastRetro"].get("finishedAt") == a_last_retro.get("finishedAt")

        print("=== ALL ERRORS: a=", a_errors, "b=", b_errors)
        assert a_errors == [] and b_errors == []
        print("PASS")
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
