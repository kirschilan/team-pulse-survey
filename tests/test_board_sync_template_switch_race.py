from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Real bug, reported from usage (not language-specific -- happened to be
# spotted via a Hebrew translation mismatch, but the underlying defect is
# board-sync racing a template switch): loading a starter template writes
# the new dimension docs, THEN the new meta/config doc, as two SEPARATE
# Firestore-like operations (templates.js's loadTemplate()). Board sync is
# default-on for every device now (STATUS.md's "Board sync" plan, step 7),
# and its own db.js listeners call pushBoardSnapshotIfConnected() on EVERY
# squads/dimensions/config change independently -- so the moment the new
# dimension docs land, a push fires built from `state` at THAT instant:
# the NEW dimensions, but still the OLD config (activeTemplateName/
# attribution), since the config write hasn't landed yet. That
# inconsistent intermediate snapshot reaches the relay and echoes straight
# back to this same device's own live "boards/<roomId>" subscription,
# which (board-sync.js's applyRemoteBoardSnapshot()) rewrites the LOCAL
# meta/config back to match it -- regressing activeTemplateName/attribution
# to the PREVIOUS template even though the dimensions themselves (written
# after, so present in that same intermediate push) end up correct. Net
# effect: dimensions say "Tuckman," but config still says "Spotify."
#
# board-sync.js already has an established guard for exactly this class of
# problem -- the `hydrating` flag suppresses pushBoardSnapshotIfConnected()
# while a multi-doc REMOTE snapshot is being applied locally, precisely so
# no partially-applied intermediate state escapes to the relay. loadTemplate()
# never used the equivalent guard for its own multi-doc LOCAL rewrite.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_tpl_race_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8798
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
        ctx = browser.new_context()
        ctx.add_init_script("window.SQUAD_PULSE_RELAY_URL = %r;" % RELAY_URL)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(INDEX_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(500)  # let default-on team sync connect and settle

        print("=== switching starter templates while board sync is connected (default-on) ===")
        page.click('.view-btn[data-view="admin"]')
        page.wait_for_timeout(150)
        page.click('#templatesBtn')
        page.wait_for_timeout(150)
        page.click('#tplList .tpl-row[data-id="starter-tuckman"] [data-action="load"]')
        page.wait_for_timeout(150)
        page.click('#confirmOk')
        page.wait_for_timeout(1500)  # give any intermediate push + self-echo race time to happen

        active_name = page.evaluate("state.config.activeTemplateName")
        attribution_matches_tuckman = page.evaluate("state.config.attribution === TUCKMAN_TEMPLATE.attribution")
        dim_keys = page.evaluate("state.dimensions.map(d=>d.key).sort()")
        print("activeTemplateName:", active_name)
        print("attribution matches Tuckman's:", attribution_matches_tuckman)
        print("dimension keys:", dim_keys)
        assert dim_keys == sorted(["forming", "storming", "norming", "performing", "adjourning"])
        assert active_name == "Tuckman's Team Development Stages", \
            "config regressed to the previous template -- board-sync echoed an inconsistent intermediate push"
        assert attribution_matches_tuckman, "attribution regressed to the previous template's"

        print("=== a reload picks up the SAME (correct) state from the relay, not a regressed one ===")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(700)
        active_name_after_reload = page.evaluate("state.config.activeTemplateName")
        dim_keys_after_reload = page.evaluate("state.dimensions.map(d=>d.key).sort()")
        print("activeTemplateName after reload:", active_name_after_reload)
        print("dimension keys after reload:", dim_keys_after_reload)
        assert active_name_after_reload == "Tuckman's Team Development Stages"
        assert dim_keys_after_reload == sorted(["forming", "storming", "norming", "performing", "adjourning"])

        print("errors:", errors)
        assert not errors, "unexpected JS errors: " + str(errors)
        print("=== ALL BOARD SYNC / TEMPLATE SWITCH RACE CHECKS PASSED ===")
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=3)
    except Exception:
        relay_proc.kill()
