from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Story 7: the facilitator's consolidation table (one anonymous row per
# submitted teammate, banded per dysfunction) plus manual override of any
# dimension's consolidated color/trend before finishing. The override lives
# on the SESSION doc (sessions/{id}.overrides.{dimKey}), not the squad --
# it only becomes the squad's real rating once the retro is finished
# (covered in test_v11.py), and it reuses the existing rating-editor modal
# in a distinct "session" mode.

out_path = build_page(out_name="_test_v10.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1200})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#templatesBtn')
    page.wait_for_timeout(150)
    page.click('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="load"]')
    page.wait_for_timeout(100)
    page.click('#confirmOk')
    page.wait_for_timeout(300)

    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    page.click('#startSessionBtn')
    page.wait_for_timeout(250)

    session_info = page.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.startsWith('sessions/'); })[0];
        return { id: k.split('/')[1], doc: window.__FAKE_STORE__[k] };
      })();
    """)
    sid = session_info["id"]
    dim_keys = [d["key"] for d in session_info["doc"]["dimensions"]]
    print("=== session started ===", sid, dim_keys)
    print("overrides field defaults to {}:", session_info["doc"].get("overrides"))
    assert session_info["doc"].get("overrides") == {}

    # 3 responses: trust = good, good, crit (majority good, 2 vs 1); every
    # other dimension unanimous good across all 3
    responses = [
        {"answers": {k: ([3,3,3] if k!="trust" else [3,3,3]) for k in dim_keys}},
        {"answers": {k: ([3,3,3] if k!="trust" else [3,3,3]) for k in dim_keys}},
        {"answers": {k: ([3,3,3] if k!="trust" else [1,1,1]) for k in dim_keys}},
    ]
    page.evaluate("""
      (function(responses){
        responses.forEach(function(r, i){
          window.__FAKE_STORE__['sessions/%s/responses/r'+i] = r;
        });
        window.__NOTIFY__('sessions/%s/responses');
      })(%s);
    """ % (sid, sid, json.dumps(responses)))
    page.wait_for_timeout(200)

    print("=== while held: no override buttons, no response table ===")
    assert page.query_selector('.override-btn') is None
    assert page.query_selector('.resp-details') is None

    print("=== flip to live ===")
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_timeout(200)

    trust_row_text = next(t for t in page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)') if "Absence of Trust" in t)
    print("trust row before override (2 good vs 1 crit -> majority good):", trust_row_text)
    assert "Green" in trust_row_text
    assert "Overridden" not in trust_row_text
    print("errors:", errors)

    print("=== open the override editor for trust ===")
    page.click('.override-btn[data-override-dim="trust"]')
    page.wait_for_timeout(150)
    assert page.is_visible('#backdrop') or not page.eval_on_selector('#backdrop', 'el => el.hidden')
    title = page.eval_on_selector('#modalTitle', 'el => el.textContent')
    squadline = page.eval_on_selector('#modalSquadline', 'el => el.textContent')
    print("modal title / squadline:", title, "/", squadline)
    assert title == "Absence of Trust"
    assert "overrid" in squadline.lower()
    # pre-selected to the CURRENT consolidated result (good), no override yet
    assert page.eval_on_selector('.swatch[data-color="good"]', 'el => el.className').find("selected") != -1
    reset_hidden = page.eval_on_selector('#modalResetOverride', 'el => el.hidden')
    print("reset-to-consolidated button hidden (should be True, no override set yet):", reset_hidden)
    assert reset_hidden == True

    print("=== override trust to Red / declining, with a note ===")
    page.click('.swatch[data-color="crit"]')
    page.click('#trendsel button[data-trend="down"]')
    page.fill('#modalNote', "SM feels the room is worse than the numbers show")
    page.click('#modalSave')
    page.wait_for_timeout(200)

    stored_override = page.evaluate("window.__FAKE_STORE__['sessions/%s'].overrides.trust" % sid)
    print("stored override:", stored_override)
    assert stored_override["color"] == "crit"
    assert stored_override["trend"] == "down"
    assert "worse" in stored_override["note"]

    trust_row_text2 = next(t for t in page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)') if "Absence of Trust" in t)
    print("trust row after override:", trust_row_text2)
    assert "Red" in trust_row_text2
    assert "Overridden" in trust_row_text2
    assert page.query_selector('.live-dim-row .dim-trend.down') is not None
    print("errors:", errors)

    print("=== reopening the override editor shows the existing override + reset button ===")
    page.click('.override-btn[data-override-dim="trust"]')
    page.wait_for_timeout(150)
    assert page.eval_on_selector('.swatch[data-color="crit"]', 'el => el.className').find("selected") != -1
    assert page.eval_on_selector('#trendsel button[data-trend="down"]', 'el => el.className').find("selected") != -1
    assert page.eval_on_selector('#modalNote', 'el => el.value').find("worse") != -1
    reset_hidden2 = page.eval_on_selector('#modalResetOverride', 'el => el.hidden')
    print("reset button hidden now (should be False):", reset_hidden2)
    assert reset_hidden2 == False

    print("=== clearing the override falls back to the consolidated result ===")
    page.click('#modalResetOverride')
    page.wait_for_timeout(200)
    stored_override2 = page.evaluate("window.__FAKE_STORE__['sessions/%s'].overrides.trust" % sid)
    print("stored override after reset:", stored_override2)
    assert not stored_override2
    trust_row_text3 = next(t for t in page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)') if "Absence of Trust" in t)
    print("trust row after reset:", trust_row_text3)
    assert "Green" in trust_row_text3
    assert "Overridden" not in trust_row_text3
    print("errors:", errors)

    print("=== the per-response table lists all 3 anonymized responses correctly ===")
    page.click('.resp-details summary')
    page.wait_for_timeout(100)
    rows = page.query_selector_all('.resp-table tbody tr')
    print("response rows:", len(rows))
    assert len(rows) == 3
    row_labels = page.eval_on_selector_all('.resp-table tbody tr th', 'els => els.map(e => e.textContent)')
    print("row labels (anonymized):", row_labels)
    assert row_labels == ["Response 1", "Response 2", "Response 3"]
    # trust column is the 1st data column (dimensions come first in template order)
    trust_col_pills = page.eval_on_selector_all('.resp-table tbody tr', 'rows => rows.map(r => r.querySelectorAll("td")[0].textContent.trim())')
    print("trust column across the 3 responses (good, good, crit):", trust_col_pills)
    assert trust_col_pills == ["Green", "Green", "Red"]
    print("errors:", errors)
    page.screenshot(path=str(test_output_path("shot_v10_override_and_table.png")), full_page=True)

    print("=== ALL ERRORS:", errors)
    browser.close()
