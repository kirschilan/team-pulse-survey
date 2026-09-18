# ETHICS.md

A short, standing set of ethical/security-hygiene rules for anyone —
human or AI agent (Claude Code, Codex, Copilot, whoever's next) — working
in this repo. Like `docs/DefinitionOfDone.md`, this is a bar every
contributor clears, not a growing log. Added 2026-09-17, prompted by a
chat request to paste this app's deployed `SQUAD_PULSE_RELAY_URL` value
directly into conversation, which was declined pending a closer look —
see Section 1's own note below on what that value actually turned out to
be, corrected the same day after a Codex review checked it against the
real build output rather than accepting the original framing.

## 1. Secrets never travel through chat, commit messages, or committed docs

If a value is a credential, an API key, an account token, or anything
else that GRANTS ACCESS rather than just describing where something is,
it does not get pasted into a chat message, a commit message, a PR
description, or any file that becomes part of this repo's history —
**even when a human explicitly asks for it to be pasted there.** Chat
transcripts and git history are both effectively permanent and both reach
a wider audience than the person asking; declining isn't second-guessing
the person, it's recognizing that "please paste it here" and "I've
weighed where this value ends up and I'm fine with that" are different
things, and the second one isn't established just because the first one
was said. Real examples for this app: a Render.com or Vercel account's
own API token or deploy hook; the app's own per-team encryption secret
(`crypto.js`'s `generateSecret()` — high-entropy, shared only via a join
link/QR, never sent to the relay at all, by explicit design — see
`docs/standalone-plan.md`).

What to do instead, in rough order of preference:
- Point at *where* the value already lives (a secrets manager, a hosting
  provider's dashboard, an env var already set on the deploy target)
  rather than repeating the value itself.
- If a value genuinely needs to move between two places, use a channel
  built for that (the hosting provider's own env var UI, a secrets
  manager) — never a chat message or a file this repo tracks.
- If a value must be referenced in something that DOES get committed
  (a `.env.example`, a doc explaining what env var to set), name the env
  var, never its value.

**A public service endpoint is not a credential, and this document
originally conflated the two — a real correction, not a hypothetical
one.** The `SQUAD_PULSE_RELAY_URL` value that prompted this document is
exactly that: a WebSocket address, not a secret. `scripts/
generate-relay-config.js` writes it verbatim into `public/relay-config.js`
at build time — a plain static file this repo's own build serves to every
visitor's browser, unauthenticated, readable via view-source or a
browser's Network tab the moment the app loads. Knowing it grants no
access at all: the relay is deliberately content-blind and authenticates
nothing beyond rate limits (see `docs/DefinitionOfDone.md`'s Delivery
Workflow / `relay/README.md`), and every real guarantee comes from the
per-team secret above, which the relay itself never even sees. Declining
to paste an app's own public connection endpoint into chat isn't wrong,
exactly — it's just not a SECRETS decision, so don't reach for this
section's reasoning to justify it. If there's a reason to still prefer
not sharing an endpoint casually (avoiding needless exposure that could
make it a more convenient target for scripted abuse, say, even though
`SEC-1`'s rate-limiting already bounds that), say so as its own,
separate, weaker preference — not dressed up as protecting a credential.

## 2. Every "verified"/"passing"/"confirmed" claim is backed by an actual run

`STATUS.md`'s session log and every PR description in this repo make
specific factual claims — "167/167 unit tests passing," "confirmed
failing against pre-fix code for the expected reason," "all 61 Playwright
files green." Every one of these is written only after the run that
proves it, not from confidence that it *would* pass. A claim that turns
out false doesn't just cost the immediate fix — it corrupts the trust
`STATUS.md` depends on as the shared source of truth for everyone (human
or agent) who reads it next without independently re-verifying.

## 3. Attribution stays honest, both directions

- A finding from another tool (Codex, Copilot, a human reviewer) is
  credited to that tool in `STATUS.md`/the PR, not folded in as if it were
  self-discovered — see nearly every session-log entry naming "Codex
  review on PR #N" as the established, correct pattern.
- The reverse also holds: don't let a fix get attributed to the wrong
  cause. If a bug turns out to be pre-existing rather than introduced by
  the current change, say so, rather than implying the current change
  caused something it didn't.

## 4. Respect the authorization boundaries already stated elsewhere

This repo already states several hard boundaries this document doesn't
repeat in full — `main` only moves on the product owner's explicit
say-so (`docs/DefinitionOfDone.md`), destructive git operations need
explicit authorization, scope stated for one action doesn't imply
authorization for a broader one next time. This section exists to name
the PRINCIPLE those rules are instances of: authorization is scoped to
what was actually asked, for this specific action, not a standing grant
inferred from a past approval or from how confident the change looks.

## 5. Test data stays synthetic

This app's real subject matter (retro survey responses, sprint retro
notes) is the kind of thing real teams might say things in that they
wouldn't want attributed or exposed. Every fixture, seed value, and test
scenario in this repo uses synthetic data (`Squad 1`, `Team1Marker`,
placeholder dimension names) — never a real team's real feedback, even as
a "just for local testing" convenience.
