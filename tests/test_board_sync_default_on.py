from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Step 7 of STATUS.md's "Board sync" plan: promote from opt-in to
# default-on. Steps 1-6 built a fully opt-in feature (a device stays
# local-only until someone explicitly clicks "Create a team link" or opens
# one). This step flips the default: a brand-new device now auto-generates
# its own team secret at first boot and is ready to share immediately --
# no click needed -- while still respecting an explicit "stop syncing"
# and still letting a device switch onto someone else's team via their link.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_default_on_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8787 + 42  # distinct from the app's own dev-default port
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


def poll_pushed_board(page, secret, predicate, timeout=5.0):
    """Repeatedly re-fetches the board doc straight from the relay until
    predicate(data) is true, instead of guessing how long a real relay
    round trip (roomIdFor() + a WebSocket push) takes to land. Each call is
    a fresh read, so this genuinely waits for the push to arrive rather
    than trusting a cached/local view."""
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        result = page.evaluate("""async (secret) => {
          const roomId = await SquadPulseCrypto.roomIdFor(secret);
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/" + roomId, secret).get();
          return snap.exists ? snap.data() : null;
        }""", secret)
        if predicate(result):
            return result
        time.sleep(0.05)
    return result


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

        print("=== HAPPY PATH: a brand-new device boots straight into a connected, shareable team ===")
        a_ctx = browser.new_context()
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        # eval_on_selector()/query_selector() below don't auto-wait --
        # renderAdminSquadList() only populates this once the async store load +
        # first render() pass lands, so this is the real boot-complete marker
        # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
        a.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
        # ensureDefaultTeamSecret()/renderTeamSyncStatus() (board-sync.js) both
        # run synchronously at script-load time -- device A's team link is
        # already populated the instant goto() returns, no wait needed.
        a.click('.view-btn[data-view="admin"]')

        connected_hidden = a.eval_on_selector("#teamSyncConnected", "el=>el.hidden")
        not_connected_hidden = a.eval_on_selector("#teamSyncNotConnected", "el=>el.hidden")
        print("connected panel hidden (should be False):", connected_hidden)
        print("not-connected panel hidden (should be True):", not_connected_hidden)
        assert connected_hidden is False
        assert not_connected_hidden is True
        a_link = a.eval_on_selector("#teamLinkInput", "el=>el.value")
        print("device A's default team link (no click needed):", a_link)
        assert "#team=" in a_link, "SEC-4: the secret rides in the URL fragment now, never the query string"
        assert a.eval_on_selector("#teamQr svg", "el=>!!el") is True
        print("errors:", a_errors)

        print("=== a squad rename pushes to this default team automatically -- no 'Create' step was needed ===")
        a.click('.admin-squad-name[data-id="squad-1"]')
        name_input = a.query_selector('.admin-squad-name[data-id="squad-1"]')
        name_input.fill("Auto-synced squad")
        name_input.dispatch_event("change")
        import re
        a_secret = re.search(r"[?&#]team=([^&]+)", a_link).group(1)
        # renameSquad() (squads.js) triggers a real relay round trip
        # (pushBoardSnapshotIfConnected() -> roomIdFor() -> a real WebSocket
        # write) -- poll the relay's own doc directly instead of guessing
        # how long that takes.
        pushed = poll_pushed_board(a, a_secret, lambda data: data is not None and any(s["name"] == "Auto-synced squad" for s in data["squads"]))
        print("board actually on the relay for A's default team:", pushed and [s["name"] for s in pushed["squads"]])
        assert pushed is not None
        assert any(s["name"] == "Auto-synced squad" for s in pushed["squads"])

        print("=== RAINY DAY: a SECOND, independently-fresh device does NOT default onto the SAME team ===")
        b_ctx = browser.new_context()
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(INDEX_URL, wait_until="domcontentloaded")
        b.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
        b.click('.view-btn[data-view="admin"]')
        b_link = b.eval_on_selector("#teamLinkInput", "el=>el.value")
        print("device A's link:", a_link)
        print("device B's link:", b_link)
        assert b_link != a_link, "two never-configured devices must each get their OWN random team, not silently share one"
        b_names = b.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("device B's own squads (should be the plain defaults, not A's renamed one):", b_names)
        assert "Auto-synced squad" not in b_names
        print("errors:", b_errors)

        print("=== device B can still switch onto device A's team via the real link ===")
        b_join_input = b.query_selector("#teamJoinInput")
        assert b_join_input is not None, "the 'paste a team link' affordance should still exist for switching onto someone else's team"
        b.fill("#teamJoinInput", a_link)
        b.click("#teamJoinBtn")
        b.wait_for_function("() => Array.from(document.querySelectorAll('#adminSquadList input.admin-squad-name')).some(i => i.value === 'Auto-synced squad')")
        b_link_after = b.eval_on_selector("#teamLinkInput", "el=>el.value")
        print("device B's link after joining A's team:", b_link_after)
        assert b_link_after == a_link
        b_names_after = b.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("device B's squads after switching (should now include A's renamed squad):", b_names_after)
        assert "Auto-synced squad" in b_names_after

        print("=== RAINY DAY: 'stop syncing' is respected -- no silent auto-regeneration on the next reload ===")
        # stopTeamBoardSubscription()/setTeamSecret("")/renderTeamSyncStatus()
        # (board-sync.js) are all synchronous -- no wait needed after this click.
        b.click("#teamDisconnectBtn")
        assert b.eval_on_selector("#teamSyncNotConnected", "el=>el.hidden") is False
        b.reload(wait_until="domcontentloaded")
        # A real reload re-runs the whole async boot sequence -- wait for the
        # real boot-complete marker again, not a guessed sleep.
        b.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
        b.click('.view-btn[data-view="admin"]')
        still_not_connected = b.eval_on_selector("#teamSyncNotConnected", "el=>el.hidden")
        print("device B still shows 'not connected' after a reload following an explicit disconnect (should be False):", still_not_connected)
        assert still_not_connected is False, "an explicit stop-syncing must survive a reload, not silently re-enable itself"

        print("=== device B can still manually re-enable syncing from the disconnected state ===")
        # connectWithSecret() (board-sync.js) calls setTeamSecret()/
        # renderTeamSyncStatus() synchronously before kicking off its
        # (un-awaited) hydrate/push/subscribe chain -- the new link and
        # connected-panel visibility checked right below are already
        # correct the instant this click's handler returns.
        b.click("#teamCreateBtn")
        assert b.eval_on_selector("#teamSyncConnected", "el=>el.hidden") is False
        b_link_new = b.eval_on_selector("#teamLinkInput", "el=>el.value")
        print("device B's freshly re-created link:", b_link_new)
        assert b_link_new != a_link and b_link_new != b_link, "re-enabling manually should generate a NEW team, not silently resurrect an old one"

        print("=== ALL ERRORS: a=", a_errors, "b=", b_errors)
        assert a_errors == [] and b_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
