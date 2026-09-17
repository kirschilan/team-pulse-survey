# Credits and informational terms — review notes

Draft PR, 2026-09-15. User explicitly chose informational terms with no acceptance
tracking. Closing the splash saves only `squadpulse:welcomeSeen=1`; it does not
accept terms. Terms are marked draft v0.1, dated 2026-09-15, with no effective date
until the owner approves wording. No jurisdiction, legal entity, deletion promise,
or retention period has been invented. The deployment operator must supply its own
contact/retention details before publication if needed.

## Sources checked

- Spotify's original model: https://engineering.atspotify.com/2014/9/squad-health-check-model
- Ben Linders' resource collection: https://www.benlinders.com/agile-self-assessments/
  (confirms resources, not the exact ancestry of this project's adapted questions).
- The Table Group: https://fivedysfunctions.tablegroup.com/
- Its assessment FAQ: https://files.tablegroup.com/wp-content/uploads/2021/02/02131618/the_five_dysfunctions_of_a_team_online_assessment.pdf
  states both the online and book/field-guide assessments are copyrighted and may
  not be reproduced/transmitted. Existing app assessment reuse permission is NOT
  established by adding attribution; the owner must resolve this before release.
- Tuckman (1965): https://doi.org/10.1037/h0022100
- Tuckman & Jensen (1977): https://doi.org/10.1177/105960117700200404
  These identify the developmental model, standard academic terminology, not the
  20-statement questionnaire's disputed content. **Provenance of the questionnaire
  itself is resolved — see "Tuckman 20-statement questionnaire — provenance" below.**
- QR generator: https://github.com/kazuhikoarase/qrcode-generator/blob/master/LICENSE
- Public Sans: https://github.com/google/fonts/blob/main/ofl/publicsans/OFL.txt
- Archivo: https://github.com/google/fonts/blob/main/ofl/archivo/OFL.txt

Full upstream QR/font notices are included under `public/licenses/`; Apache 2.0
is copied from the repository LICENSE so it is available in the deployed site.
Model/assessment content is expressly distinguished from the software license.
Existing per-template attribution text and assessment data are unchanged.

## First-visit behavior

Ordinary visits without the marker open the splash. All close routes remember
its dismissal locally. Existing browsers without a marker see it once too: this
is a new preference, not a board schema migration. Invitation intent is captured
before board sync strips `team` from the URL, so team/session/co-facilitator links
bypass automatic display. They do not mark the splash seen unless a user manually
opens and closes it. Storage denial allows closing, but cannot preserve a choice
across reloads. English/Hebrew content follows the app's selected locale.

Existing feature tests seed the returning-visitor preference through the shared
page builder. The dedicated first-visit test opts out and exercises actual
production behavior, invitation bypass, reload, storage denial, credits and terms.
There is no production test flag disabling the feature.

## Tuckman 20-statement questionnaire — provenance (resolved 2026-09-17)

Source: Original content authored by Claude (a separate Claude.ai chat, ~2026-09-03/04),
at the user's request, after the user supplied it as a .docx to this project.

Evidence: Shared chat transcript at https://claude.ai/share/b4751645-1989-45db-8015-1e16cc2eceee
("Shared by kirschi. This is a copy of a chat between Claude and kirschi.").

  User: "Here is a self assessment questionnaire for The Five Dysnunctions of a Team that
  teammates can answer and share... I want to find or create a similar quetionnaire for
  Tuckman's model of team maturity. Find or suggest a set of questions..."

  Claude (turn 1): named two specific existing published instruments it found via web search
  -- a 40-item questionnaire (Mosaicmennonites) and a 32-item "Everyone A Leader" survey
  (BiteSize Learning) -- then offered an alternative instead of using either verbatim: "If you
  want something closer to the Lencioni format, I can create a 15-item Tuckman assessment (3
  per stage)... Would you like me to build that streamlined version? Or would you prefer one
  of the existing tools...?"

  User: "Build a streamlined version of 3-5 items per stage"

  Claude (turn 2, delivering the .docx): "I've built a 20-item Tuckman assessment that mirrors
  the Lencioni format -- same 3-point scale, same rapid diagnostic structure, same
  section-based scoring... Scoring works the same way: sum each stage (range 4-12)...
  Interpretation guidance built in: 10-12 = Stage is prominent, 8-9 = Emerging/transitioning
  through, 4-7 = Not currently characteristic."

Conclusion: Original work, not a copy of a named third-party instrument. Claude was offered a
choice between two specific existing published Tuckman assessments and explicitly did not use
either -- it wrote new statement text and built the 20-item structure itself, at the user's
direction, only borrowing the *format* (3-point scale, N items per category summed into bands)
from the user's own Five Dysfunctions/Lencioni reference material. Two attributions are
therefore worth recording for completeness rather than as a rights concern:
(a) Bruce Tuckman's stage model itself (forming/storming/norming/performing/adjourning, 1965)
    is the conceptual basis being assessed, standard academic terminology, not the
    assessment's disputed content;
(b) the assessment's scale/scoring *format* deliberately mirrors Patrick Lencioni's Five
    Dysfunctions instrument's structure (3-point scale, summed bands) by explicit design
    choice -- but no statement text was copied from Lencioni's assessment or from either of
    the two named existing Tuckman instruments Claude found and declined to use.

No further rights review action needed for this item; the "not yet verified" language has been
removed from the credits UI (`about.creditTuckman` in `public/js/locales/en.js`/`he.js` and
`public/index.html`) and replaced with the attribution above.
