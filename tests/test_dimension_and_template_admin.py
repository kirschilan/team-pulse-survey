from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_custom_page, test_output_path

FAKE_CLAUDE_JS = r"""
<script>
(function(){
  // ---- minimal fake Firestore-like store, mimicking the artifact db contract,
  // including frozen doc.data() to reproduce the platform's real behavior ----
  var STORE = {};
  var LISTENERS = [];

  function seed(){
    for (var i=1;i<=7;i++){
      STORE["squads/squad-"+i] = {name:"Squad "+i, order:i, dimensions:{}};
    }
    var dims = [
      ["release","Easy to release",1],["process","Suitable process",2],["techquality","Tech quality",3],
      ["value","Value",4],["speed","Speed",5],["mission","Mission",6],["fun","Fun",7],
      ["learning","Learning",8],["support","Support",9],["pawns","Pawns or players",10],
      ["teamwork","Teamwork",11],["codebase","Codebase health",12]
    ];
    dims.forEach(function(d){
      STORE["dimensions/"+d[0]] = { label:d[1], green:"green text "+d[0], red:"red text "+d[0], order:d[2] };
    });
  }
  seed();

  function deepFreezeClone(obj){
    var copy = Array.isArray(obj) ? [] : {};
    for (var k in obj){
      copy[k] = (obj[k] && typeof obj[k]==='object') ? deepFreezeClone(obj[k]) : obj[k];
    }
    return Object.freeze(copy);
  }
  function deepMerge(target, patch){
    for (var k in patch){
      if (patch[k] && typeof patch[k]==="object" && !Array.isArray(patch[k]) &&
          target[k] && typeof target[k]==="object" && !Array.isArray(target[k])){
        deepMerge(target[k], patch[k]);
      } else {
        target[k] = patch[k];
      }
    }
    return target;
  }

  function notify(collectionPath){
    LISTENERS.filter(function(l){ return l.collectionPath===collectionPath; }).forEach(function(l){
      l.cb(buildSnapshot(collectionPath));
    });
  }

  function buildSnapshot(collectionPath){
    var docs = [];
    Object.keys(STORE).forEach(function(path){
      if (path.indexOf(collectionPath+"/")===0){
        var id = path.slice(collectionPath.length+1);
        if (id.indexOf("/") !== -1) return; // not a direct child
        docs.push({ id: id, exists:true, data: function(){ return deepFreezeClone(STORE[path]); } });
      }
    });
    docs.sort(function(a,b){ return (a.data().order||0)-(b.data().order||0); });
    return { docs: docs, size:docs.length, empty:docs.length===0, metadata:{fromCache:false,hasPendingWrites:false} };
  }

  function docRef(path){
    return {
      id: path.split("/").pop(),
      path: path,
      get: function(){
        var d = STORE[path];
        return Promise.resolve({ id:this.id, exists: !!d, data: function(){ return d ? deepFreezeClone(d) : undefined; } });
      },
      set: function(data){ STORE[path]=data; notify(path.split("/").slice(0,-1).join("/")); notifyDoc(path); return Promise.resolve(); },
      update: function(patch){
        if (!STORE[path]) return Promise.reject({code:"invalid_argument", message:"doc missing"});
        deepMerge(STORE[path], patch);
        notify(path.split("/").slice(0,-1).join("/"));
        notifyDoc(path);
        return Promise.resolve();
      },
      delete: function(){ delete STORE[path]; notify(path.split("/").slice(0,-1).join("/")); notifyDoc(path); return Promise.resolve(); },
      collection: function(sub){ return collRef(path+"/"+sub); },
      onSnapshot: function(next, err){
        var l = { docPath: path, cb: next };
        DOC_LISTENERS.push(l);
        setTimeout(function(){
          var d = STORE[path];
          next({ id: path.split("/").pop(), exists: !!d, data: function(){ return d ? deepFreezeClone(d) : undefined; } });
        }, 10);
        return function(){ DOC_LISTENERS = DOC_LISTENERS.filter(function(x){ return x!==l; }); };
      }
    };
  }

  var DOC_LISTENERS = [];
  function notifyDoc(path){
    DOC_LISTENERS.filter(function(l){ return l.docPath===path; }).forEach(function(l){
      var d = STORE[path];
      l.cb({ id: path.split("/").pop(), exists: !!d, data: function(){ return d ? deepFreezeClone(d) : undefined; } });
    });
  }

  function collRef(path){
    return {
      path: path,
      doc: function(id){ return docRef(path+"/"+(id|| ("auto"+Math.random().toString(36).slice(2)) )); },
      add: function(data){ var id = "auto"+Math.random().toString(36).slice(2); STORE[path+"/"+id]=data; notify(path); return Promise.resolve(docRef(path+"/"+id)); },
      orderBy: function(){ return this; },
      where: function(){ return this; },
      limit: function(){ return this; },
      get: function(){ return Promise.resolve(buildSnapshot(path)); },
      onSnapshot: function(next, err){
        var l = { collectionPath: path, cb: next };
        LISTENERS.push(l);
        setTimeout(function(){ next(buildSnapshot(path)); }, 10);
        return function(){ LISTENERS = LISTENERS.filter(function(x){ return x!==l; }); };
      }
    };
  }

  window.__FAKE_STORE__ = STORE;
  window.claude = {
    use: function(name){
      if (name==="db") return Promise.resolve({ doc: docRef, collection: collRef });
      if (name==="downloads") return Promise.resolve(null);
      return Promise.resolve(null);
    }
  };
})();
</script>
"""

out_path = build_custom_page(FAKE_CLAUDE_JS, out_name="_test_dim_tpl_admin.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    console_errors = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.goto("file://" + str(out_path.resolve()))
    # eval_on_selector()/eval_on_selector_all() below don't auto-wait --
    # renderAdminSquadList() only populates this once the async store load +
    # first render() pass lands, so this is the real boot-complete marker
    # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
    print("=== initial load ===")
    print("sync text:", page.eval_on_selector("#syncText", "el=>el.textContent"))
    print("grid header count:", page.eval_on_selector_all("table.grid thead th", "els=>els.length"))
    print("JS errors so far:", errors)

    # ---- 1. rate a cell (regression: existing flow still works) ----
    # Rating now happens from Squad view (per-squad entry list), not by
    # clicking the grid directly -- the grid is Tribe view's read-only drill-down.
    # Every step here is click()/fill() -- Playwright auto-waits for each
    # target to become actionable, so the chain needs no waits of its own.
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.click('.swatch.crit')
    page.click('#trendsel button[data-trend="down"]')
    page.fill('#modalNote', "test note")
    page.click('#modalSave')
    # evaluate() below doesn't auto-wait -- poll for the real write landing
    # instead of guessing.
    page.wait_for_function("() => { var s = window.__FAKE_STORE__['squads/squad-1']; return s && s.dimensions && s.dimensions.release && s.dimensions.release.color === 'crit'; }")
    print("=== after rating squad-1/release ===")
    print("store squad-1:", page.evaluate("window.__FAKE_STORE__['squads/squad-1']"))
    print("JS errors:", errors)

    # ---- 2. open dimension manager (Admin view), edit a label, verify grid header updates ----
    page.click('.view-btn[data-view="admin"]')
    page.click('#dimManageBtn')
    # query_selector() below doesn't auto-wait -- wait for the real "dim
    # list rendered" signal instead of guessing.
    page.wait_for_selector('.dim-row[data-key="release"] input.dim-label', state="attached")
    label_input = page.query_selector('.dim-row[data-key="release"] input.dim-label')
    # No wait needed after this -- updateDimensionField() (dimensions.js)
    # mutates, re-renders, AND writes to the store all SYNCHRONOUSLY inside
    # the 'change' handler.
    label_input.fill("Release Ease RENAMED")
    label_input.dispatch_event("change")
    print("=== after rename dimension ===")
    print("store dimensions/release:", page.evaluate("window.__FAKE_STORE__['dimensions/release']"))
    header_text = page.eval_on_selector('.dim-th-label[data-dim-key="release"]', 'el=>el.textContent')
    print("grid header shows renamed label:", header_text)

    # ---- 3. add a new dimension ----
    # evaluate()/eval_on_selector_all() below don't auto-wait -- poll for
    # the 13th dimension actually landing in the store instead of guessing
    # (addDimension()'s own comment explains the DOM update comes from the
    # dimensions listener firing, not a direct call here -- but the fake
    # store's notify() invokes it synchronously either way).
    page.click('#addDimBtn')
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('dimensions/')).length === 13")
    n_rows = page.eval_on_selector_all('#dimList .dim-row', 'els=>els.length')
    print("dim rows after add:", n_rows)

    # ---- 4. reorder: move release down ----
    # evaluate() below doesn't auto-wait -- poll for the real write landing
    # (moveDimension() calls renderAll() synchronously) instead of guessing.
    page.click('.dim-row[data-key="release"] .dim-down')
    page.wait_for_function("() => { var d = window.__FAKE_STORE__['dimensions/release']; return d && d.order === 2; }")
    print("release order after move down:", page.evaluate("window.__FAKE_STORE__['dimensions/release'].order"))

    # ---- 5. delete a dimension (with confirm modal) ----
    page.click('.dim-row[data-key="codebase"] .dim-del')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    print("confirm modal visible:", page.eval_on_selector('#confirmBackdrop', 'el=>!el.hidden'))
    page.click('#confirmOk')
    # evaluate() below doesn't auto-wait -- poll for the real deletion
    # landing instead of guessing.
    page.wait_for_function("() => window.__FAKE_STORE__['dimensions/codebase'] === undefined")
    print("codebase deleted from store:", page.evaluate("window.__FAKE_STORE__['dimensions/codebase']"))
    print("JS errors:", errors)

    page.click('#dimDoneBtn')

    # ---- 6. save current setup as a template ----
    page.click('#templatesBtn')
    page.fill('#tplNameInput', "My Custom Setup")
    # eval_on_selector_all() below doesn't auto-wait -- poll for the real
    # write landing (saveCurrentAsTemplate()'s own comment explains the DOM
    # update comes from the templates listener firing, not a direct call
    # here -- but the fake store's notify() invokes it synchronously either
    # way) instead of guessing.
    page.click('#tplSaveBtn')
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).some(k => k.startsWith('templates/'))")
    tpl_rows = page.eval_on_selector_all('#tplList .tpl-row', 'els=>els.length')
    print("=== after saving template ===")
    print("template rows:", tpl_rows)
    print("JS errors:", errors)

    # ---- 7. load a different (synthetic) template via direct state manipulation, then via UI load ----
    # Load the just-saved template back (should be a no-op-ish reload) to exercise loadTemplate()
    page.click('#tplList .tpl-row [data-action="load"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    print("load confirm visible:", page.eval_on_selector('#confirmBackdrop', 'el=>!el.hidden'))
    page.click('#confirmOk')
    # evaluate() below doesn't auto-wait -- wait for the real "template
    # loaded" signal instead of guessing. meta/config is never written by
    # anything before the first loadTemplate() call in this fixture (only
    # saveCurrentAsTemplate() ran so far, which doesn't touch it), so its
    # mere existence is a reliable one-time marker here.
    page.wait_for_function("() => window.__FAKE_STORE__['meta/config'] !== undefined")
    dims_after_load = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/'))")
    print("dimension keys after loading template:", dims_after_load)
    config_after = page.evaluate("window.__FAKE_STORE__['meta/config']")
    print("meta/config after load:", config_after)
    print("JS errors:", errors)
    print("console errors:", console_errors)

    page.screenshot(path=str(test_output_path("shot_dim_tpl_admin.png")), full_page=True)
    browser.close()
