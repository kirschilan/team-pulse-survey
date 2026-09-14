from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Steps 3/7 of STATUS.md's "Board sync" plan: team sync is now default-on
# (every device auto-generates its own team link at first boot -- see
# test_board_sync_default_on.py for that specifically), reworked after the
# security fix in the same plan's session log to a high-entropy team LINK
# rather than a typed code. This test covers what's specific to the PUSH
# mechanics rather than the default-on bootstrap itself: (1) an ordinary
# board change (adding a squad) pushes a real, decryptable snapshot a
# second device -- reading via the secret parsed out of device A's link --
# can see directly off the relay, (2) a wrong/guessed secret can't read
# it, and (3) disconnecting genuinely stops further pushes from reaching
# the relay, not just the UI's own connected/not-connected label.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8794
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

        a_ctx = browser.new_context()
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_timeout(300)
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_timeout(100)

        print("=== device A already has a default team link (step 7: default-on) ===")
        assert a.eval_on_selector("#teamSyncConnected", "el=>el.hidden") is False

        b_ctx = browser.new_context()
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b.goto(INDEX_URL, wait_until="domcontentloaded")
        b.wait_for_timeout(300)

        print("=== adding a squad pushes a real board snapshot to device A's own default team ===")
        status_after = a.eval_on_selector("#teamSyncStatus", "el=>el.textContent")
        print("status:", status_after)
        assert "connected" in status_after.lower()
        team_link = a.eval_on_selector("#teamLinkInput", "el=>el.value")
        print("team link:", team_link)
        assert "?team=" in team_link, "the link should carry the high-entropy secret as a query param"
        assert a.eval_on_selector("#teamQr svg", "el=>!!el") is True, "a QR code should render for the link"

        a.click("#addSquadBtn")
        a.wait_for_timeout(300)

        # device B never touched the UI at all here -- it reads the relay's
        # copy of the board directly, using the secret parsed out of the
        # SAME link A generated, exactly as a second device joining for
        # real would end up doing (opening the link, or pasting it).
        from urllib.parse import urlparse, parse_qs
        secret = parse_qs(urlparse(team_link).query)["team"][0]
        remote = b.evaluate("""async (secret) => {
          const roomId = await SquadPulseCrypto.roomIdFor(secret);
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/" + roomId, secret).get();
          return { exists: snap.exists, data: snap.data() };
        }""", secret)
        print("remote board doc:", remote)
        assert remote["exists"] is True
        names = [s["name"] for s in remote["data"]["squads"]]
        print("squad names on the relay's copy of the board:", names)
        assert "New squad" in names, "the squad just added locally should already be in the pushed snapshot"
        assert len(remote["data"]["dimensions"]) > 0

        print("=== a wrong/guessed secret can't read this team's board ===")
        wrong = b.evaluate("""async () => {
          const roomId = await SquadPulseCrypto.roomIdFor("totally-different-secret");
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/" + roomId, "totally-different-secret").get();
          return snap.exists;
        }""")
        assert wrong is False, "a different secret must land on a completely different room id"

        print("=== disconnecting stops further pushes ===")
        a.click("#teamDisconnectBtn")
        a.wait_for_timeout(150)
        assert a.eval_on_selector("#teamSyncNotConnected", "el=>el.hidden") is False

        a.click("#addSquadBtn")
        a.wait_for_timeout(300)
        remote_after_disconnect = b.evaluate("""async (secret) => {
          const roomId = await SquadPulseCrypto.roomIdFor(secret);
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/" + roomId, secret).get();
          return snap.data();
        }""", secret)
        names_after = [s["name"] for s in remote_after_disconnect["squads"]]
        print("squad names on the relay after disconnecting + adding another squad locally:", names_after)
        assert names_after.count("New squad") == 1, "the second squad add happened AFTER disconnecting, so it must not have reached the relay"

        print("=== ALL ERRORS:", a_errors)
        assert a_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
