from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# REF-3 (STATUS.md's "Code quality & refactoring backlog"): one of the two
# real coverage gaps the backlog identified for board-sync.js's
# synchronization state -- switching teams WHILE a hydrate for the PREVIOUS
# team is still in flight (a slow relay response, followed quickly by the
# facilitator switching to a different team link). Before the fix
# accompanying this test, maybeApplyRemote() had no "is this still the
# currently connected team" check of its own, and connectWithSecret() didn't
# stop the OLD team's live subscription until AFTER the new team's hydrate
# finished -- so a slow, stale hydrate for the team just left could still
# apply that team's board onto the newly-switched-to team's local board once
# it finally resolved. See board-sync.js's own new "REF-3" comment block for
# the full state-machine writeup this test's own scenario is drawn from.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_team_switch_during_hydrate.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8804  # distinct from every other RELAY_PORT in tests/*.py -- see run_all.sh's own comment on why each must be unique
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
    ["node", "server.js"], cwd=str(RELAY_DIR), env=relay_env,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)

try:
    if not wait_for_port(RELAY_PORT):
        relay_proc.terminate()
        try:
            relay_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            relay_proc.kill()
        raise RuntimeError("relay server never opened port %d" % RELAY_PORT)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        point_at_test_relay = "window.SQUAD_PULSE_RELAY_URL = %r;" % RELAY_URL

        # ---- Seed two real, distinctly-marked teams on the relay ----
        def seed_team(marker_name):
            ctx = browser.new_context()
            ctx.add_init_script(point_at_test_relay)
            page = ctx.new_page()
            page.goto(INDEX_URL)
            page.wait_for_function("() => !document.getElementById('syncText').textContent.includes('Connecting')")
            secret = page.evaluate("() => SquadPulseCrypto.generateSecret()")
            page.evaluate("(secret) => connectWithSecret(secret)", secret)
            page.click('.view-btn[data-view="admin"]')
            page.evaluate("(name) => { renameSquad('squad-1', name); }", marker_name)
            # renameSquad() writes locally + fires the squads listener, which
            # in turn calls pushBoardSnapshotIfConnected() -- poll the RELAY
            # directly (not local state) for the real push to land.
            def pushed():
                data = page.evaluate("""async (secret) => {
                  const roomId = await SquadPulseCrypto.roomIdFor(secret);
                  const snap = await state.db.doc("boards/" + roomId, secret).get();
                  return snap.exists ? snap.data() : null;
                }""", secret)
                return data and any(s.get("name") == marker_name for s in data.get("squads", []))
            deadline = time.time() + 5.0
            while time.time() < deadline and not pushed():
                time.sleep(0.05)
            assert pushed(), "seed team's marker rename never reached the relay"
            ctx.close()
            return secret

        print("=== seeding Team 1 (marker: Team1Marker) and Team 2 (marker: Team2Marker) ===")
        team1_secret = seed_team("Team1Marker")
        team2_secret = seed_team("Team2Marker")

        # ---- Device under test: starts hydrating Team 1, but Team 1's own
        # board GET is deliberately delayed -- switches to Team 2 before that
        # delayed hydrate ever resolves. ----
        ctx = browser.new_context()
        ctx.add_init_script(point_at_test_relay)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(INDEX_URL)
        page.wait_for_function("() => !document.getElementById('syncText').textContent.includes('Connecting')")

        result = page.evaluate("""
          async ([team1Secret, team2Secret]) => {
            var team1RoomId = await SquadPulseCrypto.roomIdFor(team1Secret);
            var origDoc = state.db.doc.bind(state.db);
            // Codex review on PR #23 (P2): a FIXED delay on Team 1's response
            // (was setTimeout(..., 300)) paired with a FIXED wait for Team 2's
            // hydrate to land (was setTimeout(..., 150)) makes this test's
            // pass/fail depend on wall-clock timing it doesn't control -- a
            // real relay response slower than 150ms (a loaded CI box, a slow
            // run) fails this test even though the app is behaving correctly.
            // A controlled gate replaces both: Team 1's response is held
            // indefinitely (not delayed by a fixed amount) until this test
            // explicitly releases it, and Team 2's hydrate is awaited via a
            // real completion signal (polling state.squads for its own
            // marker), not a guess at how long it "should" take.
            var releaseTeam1Get;
            var team1Gate = new Promise(function(resolve){ releaseTeam1Get = resolve; });
            state.db.doc = function(path, secret){
              var ref = origDoc(path, secret);
              if (path === "boards/" + team1RoomId) {
                var origGet = ref.get.bind(ref);
                ref.get = function(){ return team1Gate.then(function(){ return origGet(); }); };
              }
              return ref;
            };

            setTeamSecret(team1Secret);
            var staleHydrate = hydrateFromTeamIfConnected();  // held at team1Gate, not yet released

            // Switch away from Team 1 to Team 2 while Team 1's hydrate is
            // still held. connectWithSecret's own hydrate for Team 2 is NOT
            // gated/delayed -- it proceeds at its own real (fast) pace.
            connectWithSecret(team2Secret);

            // Wait for the REAL signal that Team 2's hydrate has actually
            // landed, however long that genuinely takes, rather than a fixed
            // wait -- squad-1's name only becomes Team 2's own marker once
            // Team 2's hydrate has actually applied.
            var deadline = Date.now() + 5000;
            while (state.squads.filter(function(s){ return s.id==="squad-1"; })[0].name !== "Team2Marker") {
              if (Date.now() > deadline) throw new Error("Team 2's hydrate never applied within 5s");
              await new Promise(function(resolve){ setTimeout(resolve, 20); });
            }
            var afterSwitchName = state.squads.filter(function(s){ return s.id==="squad-1"; })[0].name;

            // ONLY NOW release the held Team 1 response -- it's provably
            // stale at this point, since Team 2 has already been confirmed
            // applied.
            releaseTeam1Get();
            await staleHydrate;

            return {
              afterSwitchName: afterSwitchName,
              finalSecret: getTeamSecret(),
              finalName: state.squads.filter(function(s){ return s.id==="squad-1"; })[0].name
            };
          }
        """, [team1_secret, team2_secret])
        print("result:", result)

        assert result["afterSwitchName"] == "Team2Marker", "switching to Team 2 must apply Team 2's real data"
        assert result["finalSecret"] == team2_secret, "the device must still be connected to Team 2"
        assert result["finalName"] == "Team2Marker", (
            "the STALE Team 1 hydrate must NOT have clobbered the board after switching to Team 2 -- "
            "this is the exact race REF-3 describes"
        )

        print("errors:", errors)
        assert errors == []
        print("PASS")
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
