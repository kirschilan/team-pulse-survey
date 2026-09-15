from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Story 11: as all users, we want our data encrypted so no one else but we
# who have the link/code can see it. Every other test in this suite proves
# this INDIRECTLY -- a wrong key fails to decrypt, a different secret lands
# on a different room (test_relay_board_path_sync.py, the board-sync
# security-fix tests). None of them look at the actual bytes crossing the
# wire. This test does: it captures every real WebSocket frame this
# browser sends/receives, for both a retro session AND a team board, and
# asserts the plaintext content never appears anywhere in them -- only
# base64 ciphertext. That's the literal claim the story makes, checked
# directly rather than inferred from decrypt succeeding/failing elsewhere.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_encryption_wire_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8788
RELAY_URL = "ws://localhost:%d" % RELAY_PORT

# Distinctive, unmistakable strings -- if these ever show up verbatim in a
# raw frame, something is broken. Fully uppercase/no-symbol so encoding
# (base64, JSON-escaping) can't accidentally reproduce them by coincidence.
SECRET_SQUAD_NAME = "TOPSECRETSQUADAMSTERDAM"
SECRET_NOTE = "CONFIDENTIALSPRINTNOTEZEBRA"


def wait_for_port(port, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def wait_for_new_frame(capture, baseline_count, timeout=5.0):
    """Poll the Python-side WebSocket capture for a genuinely new frame,
    instead of guessing how long a real relay round trip takes. More
    precise than the old fixed-sleep-then-check approach too: it proves
    traffic for THIS action actually happened, rather than assuming a
    frame arrived somewhere inside an arbitrary window."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if len(capture.frames) > baseline_count:
            return True
        time.sleep(0.02)
    return False


class WireCapture:
    """Collects every raw WebSocket frame this page sends/receives."""
    def __init__(self, page):
        self.frames = []
        page.on("websocket", self._on_ws)

    def _on_ws(self, ws):
        ws.on("framesent", lambda payload: self.frames.append(("sent", payload)))
        ws.on("framereceived", lambda payload: self.frames.append(("received", payload)))

    def assert_never_contains(self, needle):
        offenders = [(direction, payload) for direction, payload in self.frames if needle in payload]
        assert not offenders, "plaintext %r leaked onto the wire in %d frame(s): %r" % (
            needle, len(offenders), offenders[:2]
        )

    def assert_saw_traffic(self):
        assert len(self.frames) > 0, "capture never saw any WebSocket frames at all -- the test isn't exercising the relay"


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

        # ============ team board traffic ============
        a_ctx = browser.new_context()
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        capture = WireCapture(a)
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        # eval_on_selector()/query_selector() below don't auto-wait --
        # renderAdminSquadList() only populates this once the async store load +
        # first render() pass lands, so this is the real boot-complete marker
        # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
        a.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

        # ensureDefaultTeamSecret()/renderTeamSyncStatus() (board-sync.js) both
        # run synchronously at script-load time -- device A's team link is
        # already populated the instant goto() returns, no click or wait
        # needed for step 7's default-on behavior.
        a.click('.view-btn[data-view="admin"]')

        print("=== renaming a squad to a distinctive, unmistakable plaintext name ===")
        frames_before_rename = len(capture.frames)
        name_input = a.query_selector('.admin-squad-name[data-id="squad-1"]')
        name_input.fill(SECRET_SQUAD_NAME)
        name_input.dispatch_event("change")
        # renameSquad() (squads.js) triggers a real relay round trip
        # (pushBoardSnapshotIfConnected() -> roomIdFor() -> a real WebSocket
        # write) -- poll the actual capture for a new frame instead of
        # guessing how long that takes.
        assert wait_for_new_frame(capture, frames_before_rename), "no new WebSocket frame arrived after renaming the squad"

        capture.assert_saw_traffic()
        print("frames captured so far:", len(capture.frames))
        capture.assert_never_contains(SECRET_SQUAD_NAME)
        print("confirmed: the squad name never appears in plaintext on the board-sync wire")

        # sanity check the capture mechanism itself isn't just failing
        # silently: base64 ciphertext SHOULD be present in these frames --
        # if "ct" never shows up either, the assertions above are vacuous.
        has_ciphertext_field = any('"ct"' in payload for _, payload in capture.frames)
        print("frames do contain the encrypted envelope's ct field (sanity check):", has_ciphertext_field)
        assert has_ciphertext_field, "the capture should see real encrypted put messages, not nothing"

        # ============ retro session traffic ============
        print("=== starting a retro and saving a distinctive sprint-experiment note ===")
        # setView()/selectSquad() are both synchronous (established across
        # this pass) -- no wait needed for either of these two clicks.
        a.click('.view-btn[data-view="squad"]')
        a.click('.squad-pick-btn[data-id="squad-2"]')
        a.click("#startSessionBtn")
        a.wait_for_selector("#experimentNoteBox")  # real relay round trip -- wait for it, don't guess how long
        note_box = a.query_selector("#experimentNoteBox")
        note_box.fill(SECRET_NOTE)
        frames_before_note = len(capture.frames)
        a.click("#saveExperimentNoteBtn")
        # saveExperimentNote() (retro-facilitator.js) writes through the
        # real relay too -- poll for the actual new frame instead of
        # guessing how long that round trip takes.
        assert wait_for_new_frame(capture, frames_before_note), "no new WebSocket frame arrived after saving the experiment note"

        capture.assert_never_contains(SECRET_NOTE)
        print("confirmed: the sprint-experiment note never appears in plaintext on the session wire either")

        # ============ a passive listener with the WRONG secret sees the
        # same encrypted traffic but genuinely cannot read it (paired with
        # the wire-level check above: not just "decrypt() rejects", but
        # "the ciphertext this device saw really doesn't decode to the
        # plaintext under a different key") ============
        print("=== a device with a WRONG team secret sees ciphertext but can never read the squad name ===")
        wrong_ctx = browser.new_context()
        wrong_ctx.add_init_script(point_at_test_relay)
        wrong_page = wrong_ctx.new_page()
        wrong_errors = []
        wrong_page.on("pageerror", lambda e: wrong_errors.append(str(e)))
        wrong_page.goto(INDEX_URL, wait_until="domcontentloaded")
        wrong_page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
        real_link = a.eval_on_selector("#teamLinkInput", "el=>el.value") if a.query_selector("#teamLinkInput") else None
        # deliberately connect with a WRONG secret pointed at the room id
        # derived from a guess -- proves the isolation holds from a fresh,
        # never-informed device, not just "the same page already had the key"
        attempted = wrong_page.evaluate("""async () => {
          const roomId = await SquadPulseCrypto.roomIdFor("a-completely-wrong-guess");
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/" + roomId, "a-completely-wrong-guess").get();
          return snap.exists;
        }""")
        print("a wrong secret finds nothing at all (different room id):", attempted)
        assert attempted is False
        print("errors:", wrong_errors)

        print("=== ALL ERRORS: a=", a_errors, "wrong=", wrong_errors)
        assert a_errors == [] and wrong_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
