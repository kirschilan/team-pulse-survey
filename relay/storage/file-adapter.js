"use strict";

// Reference "real persistence" adapter: one JSON file per room, written on
// every change and read back on the next process start. Enough to survive
// a relay restart or redeploy without losing an in-progress retro (or,
// once boards/* rooms exist, a team's synced board) -- see server.js's
// storage adapter contract for what any adapter (this one included) must
// implement, and none-adapter.js for the no-op this replaces.
//
// The room `code` is treated as fully untrusted input (it comes straight
// off the WebSocket URL) -- hashing it into the filename, rather than
// using it directly, is what keeps an odd code (path separators, "..",
// whatever) from ever touching the filesystem path.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function filenameFor(code){
  return crypto.createHash("sha256").update(String(code)).digest("hex") + ".json";
}

function FileAdapter(opts){
  opts = opts || {};
  var dir = opts.dir || process.env.RELAY_DATA_DIR || path.join(__dirname, "..", "data");
  var dirReady = null;
  function ensureDir(){
    if(!dirReady) dirReady = fs.promises.mkdir(dir, { recursive: true });
    return dirReady;
  }
  function fileFor(code){ return path.join(dir, filenameFor(code)); }

  return {
    load: function(code){
      return ensureDir().then(function(){
        return fs.promises.readFile(fileFor(code), "utf8");
      }).then(function(raw){
        try{ return JSON.parse(raw); }catch(e){ return null; }
      }).catch(function(err){
        if(err && err.code === "ENOENT") return null;
        throw err;
      });
    },
    save: function(code, docsObject){
      return ensureDir().then(function(){
        return fs.promises.writeFile(fileFor(code), JSON.stringify(docsObject), "utf8");
      });
    },
    remove: function(code){
      return ensureDir().then(function(){
        return fs.promises.unlink(fileFor(code));
      }).catch(function(err){
        if(err && err.code === "ENOENT") return;
        throw err;
      });
    }
  };
}

module.exports = { FileAdapter: FileAdapter, filenameFor: filenameFor };
