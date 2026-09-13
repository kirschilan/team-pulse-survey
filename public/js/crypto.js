"use strict";

// Client-side encryption for retro sessions, per the locked decision in
// STATUS.md: the relay stores and rebroadcasts ciphertext only. AES-256-GCM
// via the browser's native Web Crypto API (available over file://, http://
// and https:// alike -- verified before building this, since file:// has
// already surprised this project once with ES modules).
//
// The key is deliberately DERIVED FROM THE SESSION CODE (SHA-256 of the
// 6-character code) rather than an independent random secret in a URL
// fragment. That's a departure from the original standalone-plan.md sketch,
// made because this app's PRIMARY join path is typing the code by hand (the
// fix for a real iPhone QR-handoff bug already in this codebase) -- a join
// path with no fragment to carry a separate key. Deriving the key from the
// code keeps both join paths (typed code, and the link/QR) working
// identically, at a real and honest cost: since the room id IS the code,
// anyone who can compute SHA-256 of a code -- including whoever operates
// the relay -- can derive the same key. This still means real protection
// against passive network eavesdropping, and against answers sitting in
// plaintext in relay logs, memory dumps, or backups; it is NOT protection
// against a relay operator who deliberately decides to snoop. See
// docs/standalone-plan.md for the full writeup.

var SquadPulseCrypto = (function(){

  function utf8Encode(str){ return new TextEncoder().encode(str); }
  function utf8Decode(bytes){ return new TextDecoder().decode(bytes); }

  function bytesToBase64(bytes){
    var binary = "";
    for(var i=0;i<bytes.length;i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function base64ToBytes(b64){
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for(var i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // One AES-GCM CryptoKey per session code -- cheap enough to derive fresh
  // each time rather than cache, and this way nothing has to worry about
  // invalidating a cache entry.
  async function deriveKey(code){
    var digest = await crypto.subtle.digest("SHA-256", utf8Encode(String(code)));
    return crypto.subtle.importKey("raw", digest, { name:"AES-GCM" }, false, ["encrypt","decrypt"]);
  }

  // data -> {iv, ct} envelope, both base64. A fresh random IV every call --
  // required for AES-GCM's security even when reusing the same key.
  async function encrypt(key, data){
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var plaintext = utf8Encode(JSON.stringify(data));
    var ciphertext = await crypto.subtle.encrypt({ name:"AES-GCM", iv: iv }, key, plaintext);
    return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ciphertext)) };
  }

  // {iv, ct} envelope -> the original data. Throws (GCM's built-in
  // authentication check) if the envelope was tampered with, truncated, or
  // decrypted with the wrong key -- callers should expect a rejected
  // promise on a corrupt/foreign envelope, not a garbage result.
  async function decrypt(key, envelope){
    var iv = base64ToBytes(envelope.iv);
    var ciphertext = base64ToBytes(envelope.ct);
    var plaintext = await crypto.subtle.decrypt({ name:"AES-GCM", iv: iv }, key, ciphertext);
    return JSON.parse(utf8Decode(new Uint8Array(plaintext)));
  }

  // For a persistent team board (unlike a one-off retro session -- see the
  // big comment above), deriving the key from something a human types or
  // says out loud is the wrong tradeoff: a team code is user-CHOSEN
  // (people pick real words, not random strings) and, once board sync adds
  // real persistence, the thing it protects is no longer short-lived
  // either. generateSecret()/roomIdFor() split the two roles Excalidraw's
  // real architecture keeps separate: a high-entropy secret (128 bits,
  // never typed -- shared only via a link or QR, see board-sync.js) is
  // what the encryption key derives from, while a SEPARATE, one-way-derived
  // room id is all the relay ever sees for routing. Knowing the room id
  // buys an attacker nothing -- it doesn't run backward to the secret.
  function generateSecret(){
    var bytes = crypto.getRandomValues(new Uint8Array(16));
    return bytesToBase64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  async function roomIdFor(secret){
    var digest = await crypto.subtle.digest("SHA-256", utf8Encode(String(secret)));
    var bytes = new Uint8Array(digest);
    var hex = "";
    for(var i=0;i<bytes.length;i++){ hex += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); }
    return hex.slice(0, 16); // routing only, doesn't need to be secret or collision-proof at internet scale
  }

  return { deriveKey: deriveKey, encrypt: encrypt, decrypt: decrypt, generateSecret: generateSecret, roomIdFor: roomIdFor };
})();
