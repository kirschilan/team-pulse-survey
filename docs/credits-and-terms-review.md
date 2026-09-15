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
  These identify the developmental model. They do NOT establish provenance for the
  current 20-statement questionnaire or its 10–12 / 8–9 / 4–7 bands. That source
  remains unresolved and the credits say so, rather than misattribute the scale.
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
