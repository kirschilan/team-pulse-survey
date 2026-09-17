# ETHICS.md

A short, standing set of ethical/security-hygiene rules for anyone —
human or AI agent (Claude Code, Codex, Copilot, whoever's next) — working
in this repo. Like `docs/DefinitionOfDone.md`, this is a bar every
contributor clears, not a growing log. Added 2026-09-17, after a chat
request to paste this app's deployed `SQUAD_PULSE_RELAY_URL` value
directly into conversation was correctly declined and the PO asked for
the principle to be written down rather than left as one contributor's
one-off good judgment.

## 1. Secrets never travel through chat, commit messages, or committed docs

If a value is a credential, an API key, a deployed service's connection
string, or anything else that grants access rather than just describing
behavior, it does not get pasted into a chat message, a commit message, a
PR description, or any file that becomes part of this repo's history —
**even when a human explicitly asks for it to be pasted there.** Chat
transcripts and git history are both effectively permanent and both reach
a wider audience than the person asking; declining isn't second-guessing
the person, it's recognizing that "please paste it here" and "I've
weighed where this value ends up and I'm fine with that" are different
things, and the second one isn't established just because the first one
was said.

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

This isn't a new invention for this app — `crypto.js`/`board-sync.js`'s
own design already lives by the same principle at the product level (a
team's real secret is never sent to the relay, only a one-way hash of it
for routing; see `docs/standalone-plan.md`). This section just states the
same value explicitly for how contributors — including an AI agent acting
on direct instructions — handle credentials in their own workflow, since
"the app is careful with secrets" and "everyone touching the app is
careful with secrets" are two different guarantees, and only writing down
the first one left the second one resting on whoever happened to notice
in the moment.

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
