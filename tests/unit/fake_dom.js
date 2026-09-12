"use strict";

// public/js/*.js files are plain classic scripts (see STATUS.md for why --
// Chromium blocks cross-file `import` over file://, so this app is
// deliberately not ES modules). Several of them do real DOM wiring
// (document.getElementById(...).addEventListener(...)) at the TOP LEVEL of
// the file, executed immediately when the script loads, on the assumption
// that a real `document` already exists -- true in a browser, false in
// plain Node. This lets tests/unit/*.js `require()` those files anyway to
// reach their PURE functions directly, by giving `require()`-time nothing
// to trip over: every element access returns a harmless fake that accepts
// any method call or property read/write and hands back another fake.
//
// This is intentionally dumb and permissive rather than a real DOM model --
// unit tests here exist to test computation (CSV parsing, consolidation
// math), not rendering, so "don't crash on load" is the whole job. Real DOM
// behavior is exactly what the Playwright suite (tests/test_*.py) already
// covers with a real browser.
function fakeElement(){
  var target = function(){};
  return new Proxy(target, {
    get: function(obj, prop){
      if (prop === "addEventListener" || prop === "removeEventListener") return function(){};
      if (prop === Symbol.toPrimitive || prop === "toString" || prop === "valueOf") return function(){ return ""; };
      return fakeElement();
    },
    set: function(){ return true; },
    apply: function(){ return fakeElement(); }
  });
}

function installFakeDom(){
  global.document = {
    getElementById: function(){ return fakeElement(); },
    querySelector: function(){ return fakeElement(); },
    querySelectorAll: function(){ return []; },
    createElement: function(){ return fakeElement(); },
    addEventListener: function(){}
  };
  global.window = global.window || {};
  global.window.addEventListener = function(){};
  global.window.getSelection = function(){ return null; };
  global.localStorage = global.localStorage || {
    getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){}
  };
}

module.exports = { installFakeDom: installFakeDom, fakeElement: fakeElement };
