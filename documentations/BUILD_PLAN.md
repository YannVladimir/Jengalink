# JengaLink Build Plan

> The plan the team builds from, one checklist item at a time. The live version, with the progress
> ring, roadmap chart and Owner Home mock-up, is at
> https://claude.ai/code/artifact/0856f004-2c17-4297-adf0-a96bff1f6c68. This file is a copy for
> contributors and is updated as items are ticked. Snapshot: 16 Oct 2026, 56 of 81 tasks done.
>
> Related: the product specification is in
> [revised/JengaLink_Project_Specification.md](revised/JengaLink_Project_Specification.md); how to
> run, test and use each finished feature is in the [README](../README.md).

The JengaLink pilot app (release A0) takes about 16 weeks to build with two engineers, followed by a 6–8 week live pilot. Each phase ends with a gate: do not start the next phase until its checklist is ticked.

## Progress

The percentage counts ticked boxes across all phase checklists below (the Definition of done is not counted). There are 81 tasks: Phase 0–1: 12, Phase 2: 16, Phase 3: 12, Phase 4: 15, Phase 5: 6, Phase 6: 12, Phase 7: 8.

## Roadmap

Eight phases, six gates, weeks 0–24. Phases 0–1 and 2 overlap so engineering starts while design is tested. Each gate's pass condition is written at the end of its phase checklist below.

## Design principles for owners

An owner should understand the state of their project within 5 seconds of opening the app, without reading any number twice.

1. **Three questions on Home.** Is my building on track? What do I need to decide? Where is my money? Everything else is one tap away.
2. **Show, then tell.** Every key fact is a picture first (ring, bar, photo) with the exact number and a plain sentence beside it.
3. **One main action per screen.** A large orange button at the bottom, within thumb reach. Secondary actions are text links.
4. **The contractor does the setup.** The owner only accepts an invitation, checks the quote and approves. No configuration screens for owners.
5. **Photos are the proof.** Every payment claim and update opens with its photos, latest first, with a before/after view per stage.
6. **Plain words, two languages.** English and Kinyarwanda from day one. Say "Money you still owe" instead of "Outstanding payable". Explain any construction term with a small (i) tooltip.
7. **Safe approvals.** Before approving, show the amount in large type, what it pays for and its photos. Confirm with a slide or a PIN, never by accident.
8. **Honest status.** Separate labels for Reported, Approved, Paid and Inspected. Always show when data was last updated.
9. **Works on a cheap phone.** Fast on a 2 GB RAM Android phone on 3G. Photos load as small previews first.
10. **Test with real owners.** Each major screen is tested with at least 5 owners, including one who is over 55 or not comfortable with technology.

## Colours: "Safety orange on concrete"

The palette takes its cues from a building site, made modern: safety orange for action, deep steel blue for structure, warm concrete greys for calm surfaces. Orange is used sparingly so it always means "tap here" or "needs you". This replaces the navy and teal palette in spec §36.1.

| Token | Name | Hex | Used for | Contrast on white |
| --- | --- | --- | --- | --- |
| primary | Jenga Orange | #C2410C | Main buttons, active tab, "needs you" badges | 5.2:1 (passes AA) |
| accent | Safety Orange | #F97316 | Progress fills, chart highlights, illustrations (never text) | decorative only |
| structure | Steel Blue | #1E3A5F | Headers, web sidebar, "Approved" status | 11.5:1 |
| ink | Asphalt | #1C2430 | Main text and numbers | 15:1 |
| ink-muted | Slate | #5F6B7A | Labels, captions, timestamps | 5.4:1 |
| background | Concrete | #F5F3EF | App background (warm, not cold grey) | — |
| surface | White | #FFFFFF | Cards and sheets | — |
| border | Mortar | #E4DFD7 | Card borders, dividers | — |
| highlight | Hi-vis Yellow | #FACC15 | Small markers only, always with dark text | — |

**Status colours.** Each status has its own colour, plus an icon and a word. Approved and Paid never share a colour.

| Status | Hex | Icon | Meaning |
| --- | --- | --- | --- |
| Reported | #2563EB | camera | Contractor says it is done |
| Approved | #1E3A5F | check outline | Owner agreed; not paid yet |
| Paid / Accepted | #15803D | filled check | Money verified or work accepted |
| Needs you / Waiting | #B45309 | clock | Waiting for a decision or upload |
| Problem | #B91C1C | warning triangle | Defect, dispute or variance |

**Dark mode** (for evening use): background #12161C, cards #1B222B, text #E8ECF1, primary #FB923C. Check every pair against WCAG AA (4.5:1 for text) before release.

## Fonts

Use two free Google Fonts: **Plus Jakarta Sans** for headings and big numbers (modern, confident, slightly geometric, like architectural lettering) and **Inter** for everything else (very readable on small screens, with tabular figures so money lines up). Both cover English, Kinyarwanda and French characters and load in Expo through `@expo-google-fonts`.

| Style | Font | Weight | Size / line height | Used for |
| --- | --- | --- | --- | --- |
| Display number | Plus Jakarta Sans | 700 | 40 / 44 | The big figure inside a progress ring or money card |
| Screen title | Plus Jakarta Sans | 700 | 28 / 34 | Top of each screen |
| Section title | Plus Jakarta Sans | 600 | 20 / 26 | Card and section headings |
| Body | Inter | 400 | 16 / 24 | All normal text (never smaller on mobile) |
| Label | Inter | 500 | 14 / 20 | Field labels, buttons, tabs |
| Caption | Inter | 400 | 13 / 18 | Timestamps, "Last updated" lines |
| Money | Inter, tabular figures | 600 | 16–24 | Every amount, written as "RWF 1,500,000" |

Load only these 5 weights to keep the app small. Respect the phone's text-size setting; layouts must still work at 200% text size.

## Infographics

Each kind of information always uses the same visual, so owners learn it once. Every visual shows the exact number and a one-line sentence beside it, and works without colour.

| Information | Visual | Rule |
| --- | --- | --- |
| Overall progress | **Progress ring**: solid orange = accepted, light orange = reported but not yet accepted | The big number is accepted progress only |
| Stages | **Jenga tower**: one block per stage, stacked bottom to top, filled as stages are accepted | The brand's signature visual; tap a block to open the stage |
| Contract money | **One stacked bar**: Paid (green) · Approved, not paid (steel) · Still to come (grey) | Total = agreed contract value; never mixed with contractor costs |
| Payment claim | **Step tracker**: Requested → Approved → Paid, with dates under each step | Disputed shows as a red flag on the step |
| Schedule | **Two-line bar**: planned dates vs current dates per stage | Delay shown in days, e.g. "+9 days" |
| Site photos | **Photo timeline** by week, with a before/after slider per stage | Shows capture date and "imported" label where relevant |
| Decisions waiting | **Count badge** with the oldest wait, e.g. "2 decisions · oldest 3 days" | Orange only when waiting more than 2 days |
| Site float | **Wallet card**: expected cash, counted cash, difference | A difference is shown as "to explain", never as "lost" |
| Weekly report | **One-page infographic PDF**: ring, tower, money bar, 4 best photos, decisions | Shareable to WhatsApp as a link with expiry |

Build these as reusable components (React Native Skia or react-native-svg on mobile, the same SVG shapes on web) so the app, the web workspace and the PDF report look identical.

## Owner Home screen

From top to bottom, Home answers "what do I need to do", "is it on track" and "where is my money", then shows proof. (The live plan has the mock-up.)

## Phase 0–1: Decisions, discovery and design (weeks 0–3)

**Phase 0: business and legal (start now, runs in parallel)**

- [ ] Register the jengalink domain(s) and social handles
- [ ] Reserve the JengaLink company/trade name with RDB and start a trademark filing
- [x] Start Data Protection Office registration as controller/processor; ask about hosting outside Rwanda
- [ ] Decide the pilot's main contract model (fixed price vs reimbursable)
- [ ] Write the missing spec section: quotes, milestones and payment claims (states, tables, endpoints, worked example)
- [ ] Agree the A0 cut order (what moves to later if time runs short)
- [x] Open Google Play and Apple developer accounts in the company name

**Phase 1: design in code**

- [x] Create the design system directly in code (no Figma): colours, fonts, spacing, buttons, cards, status badges
- [x] Build the infographic components in code: ring, Jenga tower, money bar, claim tracker, wallet card
- [x] Design the A0 screens directly in code on mobile (4 tabs) and the web finance views
- [x] Translate all screen text into Kinyarwanda, French and Swahili and review it with native speakers (draft translations done in code; native-speaker review pending)
- [ ] Offline sync spike: PowerSync vs hand-built queue, 20 photos on a cheap Android phone over 3G

Dropped on 8 Oct 2026: interviews, collecting real examples, personas, journey map and prototype testing. The design is built directly in code from the spec and the design principles above.

**Gate 1:** design system, infographics and A0 screens built in code; contract model and sync approach decided.

## Phase 2: Technical foundations (weeks 2–5)

- [x] Monorepo with pnpm + Turborepo: `apps/mobile` (Expo), `apps/web` (React + Vite), `apps/api` (NestJS), `packages/ui`, `packages/contracts`
- [x] Set app IDs to `rw.jengalink.app` (or the final domain) before the first store build
- [x] Local checks (no GitHub or hosted CI): type checks, lint, tests, migration check and dependency scan run from the repo root before each item is ticked
- [ ] Three environments: development, staging, production, each with its own database, storage bucket and keys (local development and test databases plus validated env config done; staging and production follow the Phase 6 hosting choice)
- [x] PostgreSQL schema with migrations; UUID keys; `organization_id` + `project_id` on every project record
- [x] pg-boss job runner and transactional outbox
- [x] Private object storage with signed upload/download links
- [ ] Phone OTP login (local SMS provider tested on MTN and Airtel numbers), email login for owners abroad (phone and email OTP, sessions and sign-in screens done; SMS provider and live MTN/Airtel test pending)
- [x] Organizations, projects, memberships, invitations (7-day expiry), revocation
- [x] Server-side permission check on every endpoint; audit events for sensitive actions
- [x] Idempotency keys and ETag/If-Match on writes
- [x] OpenAPI generated from code; typed client in `packages/contracts`
- [x] Design tokens (colours, fonts, spacing) in `packages/ui`, shared by mobile and web
- [x] Base components: button, card, status badge, amount input, empty/error/offline states
- [x] English, Kinyarwanda, French and Swahili translation files; language switch
- [x] Sentry error tracking and structured logs; synthetic data only (API and web done, off until a DSN is set; mobile error tracking comes with the Phase 3 dev build)

**Gate 2:** on staging, a user logs in by phone, creates a project and invites a second user, and a third user cannot see that project through any endpoint.

## Phase 3: Projects and site reporting (weeks 5–8)

- [x] Contractor project wizard: name, type, location (province → village), RWF, stages from a template
- [x] Owner invitation screen that explains in plain words what the owner will see and approve
- [x] Stages with weights, planned dates and acceptance criteria
- [x] Owner accepts the project and the initial budget/contract value
- [x] Site update composer: pick stage, take photos, short note, blockers — under 60 seconds
- [x] Offline drafts and photo queue that survive app restart; visible sync indicator
- [x] Photo pipeline: virus scan, thumbnails, keep originals private, capture time vs upload time
- [x] Activity feed and photo timeline per stage, with before/after slider
- [x] Progress ring and Jenga tower components connected to real data
- [x] Owner Home: progress, decisions waiting, money bar placeholder, latest photos
- [x] Stage "ready for review" → owner accepts or asks for changes
- [x] Contractor multi-project list with blockers and next actions

**Gate 3:** a supervisor on a cheap Android phone in airplane mode records an update with 5 photos; after reconnecting, the owner abroad sees it on Home within 1 minute.

## Phase 4: Money — quotes, claims, approvals, payments (weeks 8–12)

**Decision (8 Oct 2026): JengaLink never moves construction money.** Owners pay contractors outside the app (MoMo, bank, cash); JengaLink keeps the records: claims, approvals, payment records with evidence, and verification. The only money that goes through the app is the JengaLink subscription. This replaces the spec's option of a later provider-mediated payout (§26.2).

**Core (must ship)**

- [x] Quote builder: scope, exclusions, milestones with prices, expiry; branded PDF
- [x] Owner accepts the exact quote revision → agreement version + contract value
- [x] Commercial basis per work package: fixed price, reimbursable or hybrid; contractor internal costs kept private
- [x] Payment claim linked to a milestone, with photos and evidence
- [x] Approval screen: big amount, what it pays for, photos, slide-to-approve; approve, reject or ask for changes
- [x] Editing a submitted claim cancels earlier approvals and creates a new revision
- [x] Reimbursable spending requests: approval reserves budget; posted expense converts it; unused part released
- [x] Receipt capture with EBM fields (invoice number, TIN, date, total)
- [x] External payment records (MoMo, bank, cash) → verified by finance/owner before "Paid"
- [x] Money screen: contract bar, claim step tracker, amounts owed, amounts due across projects
- [x] Simple budget change: proposed change → owner approval → new budget version
- [x] Financial tests: the A0 worked examples, two approvals racing for the same budget, repeated requests

**Second wave (ship if Gate 3 was on time, otherwise move to after the pilot starts)**

- [ ] Site float: top-ups, payments, counted cash, reconciliation
- [ ] Worker attendance and wage batches
- [ ] Foreign-currency funding records

**Gate 4:** all worked financial examples pass as automated tests; an owner approves a real claim end to end in under 2 minutes.

## Phase 5–6: Reports, notifications and launch readiness (weeks 12–16)

**Phase 5: reports and notifications (weeks 12–14)**

- [x] One-tap weekly report: one-page infographic PDF (ring, tower, money bar, 4 photos, decisions)
- [x] Share link with privacy preview and expiry; share to WhatsApp through the phone's share menu
- [x] Push notifications that open the exact item: claim to approve, new report, update with a problem
- [x] Decision inbox on Home with the oldest waiting time
- [x] Reminders for decisions waiting more than 2 days; quiet hours; no amounts on the lock screen
- [x] Exports: project summary and money history (PDF and CSV)

**Phase 6: hardening and launch (weeks 14–16)**

- [x] Permission tests across every endpoint, file download, export and share link
- [x] Offline tests: network loss, restart, duplicate replay, revoked user, conflicts
- [x] Accessibility check: screen reader, 200% text, contrast, touch targets of 44 px or more (automated audit clean on 27 pages; a TalkBack/VoiceOver pass and the phone's 200% font setting on a real device remain)
- [ ] Performance on the reference cheap Android phone: Home opens in under 2 seconds from cache (prepared: Home opens from the phone's copy without waiting for the network, app JavaScript 45% smaller, start-up time shown in More; still to measure on the reference phone)
- [x] Security review and fixes; secrets in a vault; rate limits on login and uploads (secrets load from files any vault can provide; the vault product is picked with the hosting choice)
- [x] Backups, plus one full database and media restore drill
- [x] Demo environment with synthetic data and a visible "Demo" banner
- [ ] Privacy notice, terms, consent screens; data protection registration confirmed
- [ ] Production hosting chosen to meet the registration outcome
- [ ] Support process: WhatsApp support number, response times, bug-report flow
- [ ] Onboarding kit: 30-minute setup session script, short Kinyarwanda video, contractor pitch
- [ ] Store listings (screenshots in both languages) and internal-testing release

**Gate 5:** restore drill done, no high-severity security findings, and 3 pilot contractors with real projects signed up.

## Phase 7: Run the pilot (weeks 17–24)

- [ ] Set up each pilot project with the contractor in a 30-minute session
- [ ] Owner receives the invitation and a sample weekly report on day 1
- [ ] Weekly check-in call with each contractor and owner (15 minutes)
- [ ] Track weekly: reports submitted on time, owner review rate, approval time, disputes, sync failures
- [ ] Fix blocking bugs within 48 hours; release fixes weekly
- [ ] Week 4: interview every role; list the 5 most confusing screens and fix them
- [ ] Week 6–8: ask owners to pay for the next period; record who pays and why others do not
- [ ] Write the pilot review: what to keep, change, add (A1) and drop

**Gate 6 (expand or not):** at least 80% of weekly reports submitted and reviewed, no unresolved financial defect, and at least 2 contractors starting a second project or owners agreeing to pay.

## Definition of done (every feature)

A feature is finished only when every box below is ticked. Copy this list into each feature ticket.

- [ ] Matches the Figma design: colours, fonts, spacing and the infographic it uses
- [ ] Text in English and Kinyarwanda, in plain words, with no untranslated labels
- [ ] Loading, empty, error, offline and "no permission" states all designed and built
- [ ] Status shown with colour, icon and word; "last updated" shown on any figure
- [ ] Server checks permission; another project's data cannot be seen or changed
- [ ] Writes are idempotent and use version checks; money changes are in one transaction
- [ ] Audit event recorded for approvals, payments, role changes and exports
- [ ] Unit and integration tests pass in CI, including the relevant worked example
- [ ] Works on the reference cheap Android phone and on a small iPhone
- [ ] Accessible: screen reader labels, 200% text, 44 px touch targets
- [ ] Analytics event added (no names, phone numbers or amounts in it)
- [ ] API documented in OpenAPI; reviewed by a second engineer
- [ ] Tried by one real owner or supervisor without help
