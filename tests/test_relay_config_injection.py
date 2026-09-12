import subprocess
import pathlib
import os
from playwright.sync_api import sync_playwright

# Regression coverage for the build-time relay URL injection added so a
# Vercel deployment (the company's own subdomain/iframe embed, or anyone
# forking this repo and deploying their own Vercel project) can point at a
# real deployed relay just by setting one environment variable
# (SQUAD_PULSE_RELAY_URL) in Vercel's project settings -- no hand-edited
# index.html per environment, and it works the same way for a Preview
# deployment (to test before merging to main) and Production.
#
# scripts/generate-relay-config.js runs as vercel.json's buildCommand and
# writes public/relay-config.js from that env var. Someone forking this
# repo onto a LAN with no Vercel account never runs this script at all --
# the checked-in public/relay-config.js placeholder is a no-op, so
# index.html's own protocol/hostname default (ws://localhost:8787 when the
# page itself is local, null otherwise) applies exactly as before. See
# relay/README.md for both paths written out for a forker.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
GENERATOR = REPO_ROOT / "scripts" / "generate-relay-config.js"
CONFIG_OUT = REPO_ROOT / "public" / "relay-config.js"

original_config = CONFIG_OUT.read_text(encoding="utf-8")

try:
    print("=== generator writes a real assignment when SQUAD_PULSE_RELAY_URL is set ===")
    result = subprocess.run(
        ["node", str(GENERATOR)],
        cwd=str(REPO_ROOT),
        env={**os.environ, "SQUAD_PULSE_RELAY_URL": "wss://relay.example.com"},
        capture_output=True, text=True,
    )
    print("stdout:", result.stdout.strip())
    assert result.returncode == 0, result.stderr
    written = CONFIG_OUT.read_text(encoding="utf-8")
    print("written config:", written.strip())
    assert written == 'window.SQUAD_PULSE_RELAY_URL = "wss://relay.example.com";\n'

    print("=== generator leaves a no-op placeholder when the variable is unset ===")
    env_without = {k: v for k, v in os.environ.items() if k != "SQUAD_PULSE_RELAY_URL"}
    result2 = subprocess.run(
        ["node", str(GENERATOR)],
        cwd=str(REPO_ROOT),
        env=env_without,
        capture_output=True, text=True,
    )
    print("stdout:", result2.stdout.strip())
    assert result2.returncode == 0, result2.stderr
    written2 = CONFIG_OUT.read_text(encoding="utf-8")
    print("written config:", written2.strip())
    assert "window." not in written2, "unset env var must not set a global at all -- index.html's own default has to apply"

    print("=== a build-injected URL survives index.html's own smart default, even on a real deployment host ===")
    # Simulate index.html's actual script order: relay-config.js (with a
    # real injected value, as Vercel's build step would produce) loads
    # BEFORE the inline `window.SQUAD_PULSE_RELAY_URL = window.SQUAD_PULSE_RELAY_URL || (...)`
    # block, so the `||` must see it already set and leave it alone --
    # this is what makes the env var actually take effect once deployed.
    injected_config = 'window.SQUAD_PULSE_RELAY_URL = "wss://relay.example.com";\n'
    CONFIG_OUT.write_text(injected_config, encoding="utf-8")

    index_html = (REPO_ROOT / "public" / "index.html").read_text(encoding="utf-8")
    start = index_html.index("<script src=\"vendor/qrcode.js\"></script>")
    end = index_html.index("<script src=\"js/crypto.js\"></script>")
    snippet = index_html[start:end]
    assert "relay-config.js" in snippet, "expected relay-config.js to load before the smart-default block"

    harness = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        + snippet.replace('src="relay-config.js"', "src='relay-config.js'")
        + "</head><body></body></html>"
    )
    harness_path = REPO_ROOT / "public" / "_test_relay_config_injection.html"
    harness_path.write_text(harness, encoding="utf-8")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("file://" + str(harness_path.resolve()))
        page.wait_for_timeout(100)
        value = page.evaluate("window.SQUAD_PULSE_RELAY_URL")
        print("resolved SQUAD_PULSE_RELAY_URL on a file:// (would-otherwise-default) page:", value)
        assert value == "wss://relay.example.com", "the build-injected value must win over the file://-is-local default"
        print("errors:", errors)
        browser.close()

    harness_path.unlink()
    print("=== ALL RELAY CONFIG INJECTION TESTS PASSED ===")
finally:
    CONFIG_OUT.write_text(original_config, encoding="utf-8")
