# JengaLink

Construction project platform — pilot release A0. Specs live in `documentations/revised/`.

## Layout

| Path | What |
| --- | --- |
| `apps/api` | NestJS API (`/health`, everything else under `/v1`) |
| `apps/web` | React + Vite web workspace (finance views, admin) |
| `apps/mobile` | Expo app (owners, contractors, supervisors) — app ID `rw.jengalink.app` |
| `packages/ui` | Design tokens shared by web and mobile |
| `packages/contracts` | Shared API types / typed client |

## Database

PostgreSQL 18 runs in Docker (Docker Desktop must be running) on port **5433**,
with two databases: `jengalink_dev` and `jengalink_test`.

```sh
pnpm services:up                             # start Postgres + file storage
pnpm db:migrate                              # apply migrations to dev
pnpm --filter @jengalink/api db:generate --name <change>   # after editing src/db/schema
pnpm db:down                                 # stop (data is kept in a Docker volume)
```

Schema lives in `apps/api/src/db/schema` (Drizzle ORM); reviewed SQL migrations in `apps/api/drizzle`.
Every project record spreads `projectScope` and adds `projectFk(t, '<name>')`: a unit test fails otherwise.
Config: `apps/api/.env` (dev) and `.env.test`, validated at startup; see `.env.example`.

## Sign-in

No passwords: phone OTP (Rwandan MTN or Airtel numbers, stored as E.164) or email OTP for owners abroad.
Codes are 6 digits, hashed, valid 5 minutes, max 5 tries; 60 s resend delay; 5 codes per hour per
number/email and 20 per hour per IP. Access tokens last 15 minutes; refresh tokens rotate on every use,
and replaying an old one ends the session. Every API route needs a session unless marked `@Public()`.

**Development:** no SMS provider yet, so the API prints each code to its console
(`[SignInCode] SMS to +250 78* *** 456: JengaLink code: 123456`). Real providers plug in behind
`CodeSender` (`apps/api/src/auth/senders.ts`). To sign in from a phone, set `EXPO_PUBLIC_API_URL`
to `http://<your-PC-LAN-IP>:3000`.

Endpoints: `POST /v1/auth/otp/start`, `POST /v1/auth/otp/verify`, `POST /v1/auth/refresh`,
`POST /v1/auth/logout`, `GET|PATCH /v1/me`, `GET /v1/me/sessions`, `POST /v1/sessions/revoke`.

## Projects and access

A project belongs to one managing organization; access needs an explicit project membership
(owner, delegate, manager, contractor, supervisor, finance, inspector, supplier, viewer).
Every project endpoint checks membership on the server through `AccessService`: no membership
gives **404** (the project is not revealed), a membership without the needed role gives **403**.

- A household owner creates a project and is its owner; a contractor creates it as contractor and
  must invite the owner, who has to accept before `POST /v1/projects/:id/activate` works.
- Invitations are bound to the phone or email they were sent to, expire after 7 days and work once.
  The SMS/email goes out through the outbox; the inviter also gets a link to share on WhatsApp.
- Removing a member takes effect on their next request; the last owner cannot be removed.

Endpoints: `POST|GET /v1/organizations`, `POST /v1/organizations/:id/invitations`,
`POST|GET /v1/projects`, `GET /v1/projects/:id`, `POST /v1/projects/:id/activate`,
`GET /v1/projects/:id/members`, `DELETE /v1/projects/:id/members/:membershipId`,
`POST /v1/projects/:id/invitations`, `GET /v1/invitations`, `GET /v1/invitations/token/:token`,
`POST /v1/invitations/:id/accept|decline`, `DELETE /v1/invitations/:id`.

## New project wizard

Contractors start a project in six short steps, on the phone (More → Start a new project) or on
the web (sidebar → Start a new project): company (only the first time), name and type, site
location, contract value, stages, then review. The project is saved as a **draft**; the owner is
invited next.

- **Types and stage templates** (spec §5.2): house, renovation, apartment building, commercial
  building, small civil works. Templates live in `packages/contracts/src/planning.ts`; their names
  are translated (`stageTemplate.*`) and saved as plain text. Removing or adding a stage
  rebalances the shares so they always total 100; the API rejects any other total.
- **Location**: province → district → sector → cell → village from Rwanda's official list
  (5 / 30 / 416 / 2,148 / 14,837), kept on the server (`apps/api/src/locations/data/rw.json`, from
  rwanda-geo, MIT). `GET /v1/locations/rw?province=…&district=…` returns the next level's options.
  The API checks every level, fixes the spelling, and refuses a skipped level.
- **Contract value** is optional, in whole RWF. JengaLink only records it; payments happen
  outside the app.

Endpoints: `POST /v1/projects` (now with `type`, `contractValue`, `stages`),
`GET /v1/projects/:id/stages`, `GET /v1/locations/rw`.

## Stage plan

Each stage has a **share of the job** (weights total 100), **planned start and end dates**, a short
description, and **acceptance criteria**: up to 10 short checks anyone can see on site
("Slab level checked at 5 points") that the owner will use to accept the stage. Open it from
More → Your projects → Plan the stages on the phone, or **Your projects** → Plan the stages on
the web (also offered right after the wizard).

- The screen shows the running total; if it isn't 100% it says so and offers **Spread to 100%**
  (keeps proportions). Stages can be renamed, reordered, added or removed. The phone uses its own
  calendar sheet (works in Expo Go); the web uses the browser's date input.
- The whole plan saves in one step with `If-Match` (the project revision), so two people can't
  overwrite each other; a stale save gets "Someone else changed this plan".
- Owner, manager and contractor can edit while the project is a **draft**. Others see it read-only.
  Once the project starts, the plan is **locked**; later changes will go through a change request
  (Phase 4). Every save is in the audit trail (`stage_plan.saved`, with counts only).
- The editor rules (`planProblems`, `spreadTo100`, `moveStage`, …) live in
  `packages/contracts/src/planning.ts`, so the phone, web and API agree.

Endpoints: `GET /v1/projects/:id/plan` and `PUT /v1/projects/:id/plan` (draft only; access is
checked before the body, so strangers always get 404). Stages gained `criteria` (migration 0009,
which also forbids an end date before the start date).

## Site updates

The contractor, site supervisor or project manager posts what happened on site: **pick the stage,
add photos, a short note and any blocker, send**. Phone: the camera button on Home or More → Your
projects → New site update. Web: Your projects → New site update. Updates start once the owner has
accepted the project; a photo or a short note is required, nothing else.

- **Photos** go straight from the phone to private storage with a short-lived signed upload
  (`POST /v1/projects/:id/uploads`), bound to that project. When the update is posted, the server
  checks each photo (present, at most 25 MB, a photo type) and moves it to its final private key.
  Up to 10 per update. Viewers only ever get 5-minute signed links.
- **Capture time vs upload time:** the camera time (or the photo's EXIF date) is stored as
  `capturedAt`; the server records when it arrived. Web uploads leave the capture time empty rather
  than guess.
- `POST /v1/projects/:id/updates` needs an `Idempotency-Key`: a retried send after a lost reply
  returns the same update instead of posting twice. `GET /v1/projects/:id/updates` lists them.
- Each update emits a `site_update.submitted` event for the activity feed and notifications later.
- **Testing on a real phone:** signed photo links must point to an address the phone can reach.
  Set `S3_PUBLIC_ENDPOINT=http://<your PC's LAN IP>:8333` in `apps/api/.env` and restart the API.

### Offline drafts and the send queue (phone)

The composer works without a connection. Every change is saved on the phone as a **draft**
(photos are copied into app storage at once, so nothing depends on the gallery or camera cache).
**Send** queues the update: if there is no connection it says "Saved on this phone" and it goes out
by itself later. The app retries on launch, when it comes back to the foreground, when the
connection returns, and every 20 seconds. Each photo is marked as uploaded the moment it reaches
storage, so a restart continues with the next one; the final send reuses its Idempotency-Key, so
nothing is posted twice. The work date is fixed when the update is written, not when it arrives.

- **Sync indicator** in every tab header: "All sent", "2 updates waiting · offline", "Sending…",
  "1 update needs attention", or "1 draft". Tapping it opens the **Outbox** (drafts to continue or
  delete, waiting updates with "Send now", and updates the server refused, with the reason).
- Server errors back off (15 s, 30 s, 1 min … up to 15 min); refused updates (for example, the
  project was paused) wait for the user instead of retrying forever.
- **Opens offline:** the app keeps the last profile and only signs out when the server says the
  session ended. On launch it saves the projects and stages you report on, so the composer has them
  offline.
- **Sign-out** warns if unsent updates exist, then wipes the phone's copy (spec §3.3).
- Storage: `src/lib/offline-files.ts` (phone: app document folder via `expo-file-system`) and
  `offline-files.web.ts` (web preview: localStorage). Queue rules: `src/lib/outbox-core.ts`, with
  unit tests run by `pnpm --filter @jengalink/mobile test`.

### Photo pipeline (virus scan, thumbnails, capture time)

After an update is posted, a background job (outbox consumer `process-photos`) handles each photo:

1. **Virus scan** of the private original with ClamAV. An infected file is **deleted** at once,
   marked `blocked`, and recorded in the audit trail (`media.quarantined`).
2. **Thumbnail:** a 480 px JPEG for lists and timelines, turned upright, with all metadata (EXIF,
   GPS) removed. A file that is not a readable photo is marked `failed`.
3. **Capture time vs upload time:** the phone's camera time is kept (`capturedAtSource: device`);
   if there is none, the EXIF date is used in the project's time zone (`exif`). `uploadedAt` is
   always when it reached the server.

**Nothing gets a link until it is clean:** photos show as `processing` with no URLs until the scan
passes; originals and thumbnails are only ever 5-minute signed links.

- **ClamAV locally:** `pnpm scan:up` (Docker, about 1 GB of memory; the first start downloads
  virus signatures), then `CLAMAV_HOST=localhost` in `apps/api/.env`. Without it, development and
  tests use a basic check that only knows the EICAR test file. **Production refuses to start
  without `CLAMAV_HOST`.**
- Storage or scanner outages make the job fail and retry; a bad file never does.

### Activity feed and stage timeline

- **Activity** (phone: the Updates tab; web: Your projects → Activity, `/projects/:id/updates`):
  the project's site updates, newest first: who, when it was sent, which stage, the work date,
  the note, any **blocker** (in red), and photo thumbnails. Filter by stage, pull to refresh, "Show
  older updates" pages back. Photos still being scanned show "Checking photo…"; blocked or broken
  ones say so. Updates still waiting on this phone appear at the top ("On this phone · waiting to
  send"). The phone remembers which project you were looking at (switch from the title).
- **Photo viewer:** full size, with **"Taken 20 Sept, 16:30 (photo data)"** and **"Sent 9 Oct,
  13:00"** side by side, previous/next, and a link to the original.
- **Stage timeline** (tap a stage on any update; web `/projects/:id/stages/:stageId`): status,
  share, planned dates, the plan's checks, a **before/after slider** (the stage's earliest and
  latest photo by capture time; drag or use the keyboard/screen reader), then every update on a
  timeline rail.
- API: `GET /v1/projects/:id/updates?stageId=&before=&limit=` and
  `GET /v1/projects/:id/stages/:stageId/timeline`.

## Quotes (Phase 4)

The contractor or manager writes a quote: **title, scope of work, priced milestones** (or **Fill
from the stage plan**, which splits the total by each stage's share to the exact franc),
**not included** items, **payment terms**, and a **valid until** date. Phone: More → Your projects →
Quotes; web: Your projects → Quotes (`/projects/:id/quotes`).

- **Drafts are private.** The owner sees a quote only once it is **sent**. A sent revision is
  **frozen**, and the database itself refuses changes to it. Editing afterwards starts revision 2
  while the owner keeps seeing revision 1 until the next send (item 2: the owner accepts an exact
  revision).
- Numbers per company and year: `Q-2026-0001`, `Q-2026-0002`… A sent quote past its date shows as
  **Expired**.
- **Branded PDF** (`Open PDF`): JengaLink header, from/for/project/dates/total, scope, the milestone
  table (breaks cleanly across pages) with the total, exclusions and terms. Every page has the
  footer "JengaLink keeps records only; it does not hold or move money" and page numbers. Drafts
  carry a "DRAFT — not sent" watermark. It is rendered in the reader's language with the Inter and
  Plus Jakarta Sans fonts (OFL, in `apps/api/src/pdf/fonts`), stored privately, and opened through
  a 5-minute link.
- API: `GET/POST /v1/projects/:id/quotes`, `GET/PUT …/quotes/:quoteId` (`If-Match`),
  `POST …/send`, `POST …/pdf`.

### Commercial basis per work package; private costs

Each milestone (work package) is priced on its own basis (spec §37.1):
- **Fixed price:** the amount is the agreed price, and the contractor carries the cost risk.
- **Cost + fee (reimbursable):** the owner pays actual cost plus a fee percentage (e.g. 10%), and
  the amount is an estimate.

The quote shows **Commercial basis: Fixed / Cost + fee / Hybrid**. The owner's view, the PDF
("Basis: Hybrid", "Cost + 10% fee (estimate)") and the agreement copy all carry it.

- **Private costs:** the contractor can enter **Your cost (private)** per package and sees their total
  cost and **estimated margin** (e.g. RWF 1,200,000, 16.7%). These live in a separate table
  (`quote_internal_costs`) and are returned only to editors who are **members of the contractor's
  company**: never to the owner, never to a contractor from another company on the same project,
  and never in the PDF or the agreement. Tests check the owner's responses and the agreement rows
  contain none of the figures.

### Owner accepts a quote → agreement version + contract value

The owner opens a sent quote and decides on **that exact revision**. On the phone they slide
("Slide to accept RWF 50,000,000"); on the web they confirm a dialog. They can also **decline**
with an optional reason.

- **Accepting** creates the next **agreement version** for the project, an append-only copy of what
  was accepted (quote number and revision, title, scope, milestones, exclusions, terms, value, who
  and when). It sets the project's **contract value** and marks the quote **Accepted**. Any newer
  unsent draft revision is dropped. The PDF of that revision then carries an "Accepted by … on …
  · Agreement version N" stamp.
- A later quote accepted on the same project becomes version 2 and the new contract value. The
  quotes page shows the **current agreement** and its history.
- Refused: a revision replaced by a newer sent one, an **expired** quote, a quote already decided, a
  stale version (`If-Match`), and anyone but the owner (or owner delegate).
- API: `POST /v1/projects/:id/quotes/:quoteId/decision` (`{ decision, revision, note? }`, `If-Match`)
  and `GET /v1/projects/:id/agreements`.

## Payment claims (Phase 4)

A claim asks the owner to pay for one milestone of the **current agreement**, with evidence. It is a
record only: the owner pays outside JengaLink. Phone: More → Payment claims; web: Your projects →
Payment claims (`/projects/:id/claims`).

- **Who:** the contractor or project manager writes claims (active projects only). The owner, and
  members given financial visibility, read them once sent. A supervisor without financial
  visibility sees no money (403). Drafts stay with the contractor's side.
- **Milestone and amount:** the claim keeps a copy of the milestone's name and agreed price. On a
  **fixed-price** milestone, standing claims (draft, submitted, approved, paid) can never add up to
  more than the agreed price, with "Claim the rest" as a shortcut. On a **cost + fee** milestone the
  amount is an estimate, so it may go above it (the screen asks for a reason in the note).
- **Evidence:** pick site updates and attach photos or PDFs (invoices, delivery notes; up to 10
  files, 25 MB each). Files go through the same virus scan as site photos. A PDF must really be a
  PDF. Nobody gets a link before the scan passes. **Send to owner** needs at least one piece of
  evidence.
- **Lifecycle:** draft → submitted (numbered `C-YYYY-NNNN` per organization). A draft, or a claim
  sent back for changes, can be edited (`If-Match`). A claim not yet approved can be withdrawn,
  which frees its amount.
- **Owner's answer** (the approval screen): amount first, what it pays for, the evidence, then
  **slide to approve** on the phone (web: a dialog that repeats the amount), **ask for changes** or
  **reject**, both with a reason. The answer names the exact claim version and amount on screen
  (`If-Match` + `amount`), so a claim changed in the meantime is refused. Only the owner or their
  delegate answers; someone on the contractor's side never approves their own claim. A claim sent
  back shows the owner's note; the contractor fixes it and sends it again. Approving does **not**
  pay: the claim reads "Approved. Not paid yet". Every answer is kept in `claim_decisions`
  (append-only in the database) and shown as the claim's history. Rejected claims stop counting
  against the milestone.
- **Revisions:** each time a claim is sent, what the owner was sent is frozen in `claim_revisions`
  (append-only): revision 1, 2, … with amount, milestone, note, the site updates and files. The
  contractor can still edit a claim that is **submitted** or **approved but not paid** (**Edit
  claim**): saving sends the next revision at once and needs a "What changed?" note. If it was
  approved, that approval is **cancelled** (the screen warns first) and the owner must approve the
  new revision; answers name the revision they answered. The milestone cannot change once sent, and
  a file taken off a sent claim is only hidden, so earlier revisions stay complete. Paid, rejected
  and withdrawn claims are final.
- API: `GET/POST /v1/projects/:id/claims`, `GET …/claims/milestones`, `POST …/claims/uploads`,
  `GET/PUT …/claims/:claimId`, `POST …/claims/:claimId/submit`, `…/cancel` and `…/decision`
  (`{ decision: approve|reject|request_changes, amount, note? }`).

## Spending requests on cost + fee work (Phase 4)

For a **cost + fee** package the owner pays actual cost plus the fee, so the contractor asks before
buying. Phone: More → Spending requests; web: Your projects → Spending requests
(`/projects/:id/spending`). JengaLink records; it never moves the money.

- **Budget lines:** each cost + fee package of the current agreement. Its **cost budget** is the
  estimate without the fee (5,500,000 at 10% → 5,000,000). Fixed-price packages take no requests
  (the contractor carries that cost). Per line the app shows **spent** (posted expenses),
  **reserved** (approved, not spent yet), **waiting** (sent, not answered) and **free** =
  cost budget − spent − reserved (spec §6.2).
- **Request:** package, purpose, needed-by date, optional stage, items (quantity with up to 3
  decimals × price per unit; each line rounded to the franc, then added; the server recalculates)
  and quotation files (photos or PDFs, virus-scanned). Numbered `SR-YYYY-NNNN`. Draft → sent →
  the owner approves, asks for changes or rejects (with a reason), on the exact version and total.
  A request over the free budget cannot be sent or approved.
- **Approval reserves.** At approval the package's budget is locked and checked again in the same
  transaction; if another approval took the room first, the owner gets the current balances
  (spec §6.3). A retried approval returns the same answer without reserving twice.
- **Expenses convert.** The contractor, manager or finance records a **direct expense** (what,
  supplier, date, amount) against an approved request (`E-YYYY-NNNN`). It posts cost and uses up
  that much of the reservation, so free budget does not move. It cannot exceed what is still
  reserved; spending more needs a new request. No payment is recorded here.
- **Closing releases** whatever is still reserved back to the package. A request not approved yet
  can be withdrawn.
- **Receipts (EBM fields, spec §26.1):** each expense takes the supplier's receipt: supplier,
  supplier TIN (9 digits), optional buyer TIN, invoice number and date, total, VAT, EBM reference
  (SDC ID, signature), QR code text, and a photo or PDF (virus-scanned, fingerprinted). States are
  kept apart: **Receipt missing** (an exception that stays visible), **Captured**, **Manually
  reviewed**, **Discrepancy found**; **Externally confirmed** is not offered until a supported RRA
  channel exists, and the screen says JengaLink does not check receipts with RRA. Warnings: the
  receipt total differs from the expense, or a possible **duplicate** (same supplier TIN and
  invoice number, or the exact same file, anywhere in the company). An independent reviewer
  (owner, delegate or finance, never the person who captured it) marks it reviewed or reports a
  discrepancy with a note; the contractor's correction sends it back to Captured. A reviewed
  receipt no longer changes.
- **Ledger:** every reserve, convert and release is a row in `budget_movements`; expenses and the
  owner's answers are append-only too (database triggers), and unique indexes stop any movement
  from being applied twice. All balances are computed from those rows.
- API: `GET /v1/projects/:id/budget`, `GET/POST …/spending`, `POST …/spending/uploads`,
  `GET/PUT …/spending/:requestId`, `POST …/:requestId/submit`, `/decision`, `/expenses`,
  `/close`, `/withdraw`; receipts: `POST …/receipts/uploads`, `PUT …/expenses/:expenseId/receipt`
  (If-Match once it exists) and `POST …/expenses/:expenseId/receipt/review`.

## Payments made outside JengaLink (Phase 4)

JengaLink never moves construction money. Payments happen by MTN MoMo, Airtel Money, bank or cash
and are **recorded** here with proof. Phone: More → Payments; web: Your projects → Payments
(`/projects/:id/payments`), or **Record a payment for this claim** on an approved claim.

- **Record:** what it pays (an approved claim, or none = an advance), paid by, paid to, amount,
  method, reference (required except for cash), date, note and proof files (screenshot, bank slip;
  virus-scanned). Numbered `P-YYYY-NNNN`. A payment can never be more than is still open on its
  claim (pending and confirmed payments count). The same method + reference seen before is
  flagged as a possible double entry.
- **Pending until confirmed (spec §6.6):** a new record is "Waiting for confirmation" and is not
  cash paid. Someone independent confirms it: the **other side** (the contractor confirms what the
  owner says they paid, and the other way round) or **finance**, never whoever recorded it. They
  confirm ("Yes, confirm RWF …") or say it did not arrive (disputed, with a note). Whoever
  recorded it can withdraw it before then.
- **Paid:** a claim becomes **Paid** when its confirmed payments cover it in full; partial
  payments show "X of Y paid · Z waiting for confirmation". Once money is recorded on a claim it
  can no longer be edited. Cash paid never changes posted cost.
- **Overview:** paid (confirmed), waiting for confirmation, still owed on approved claims, the
  approved claims to pay, and every payment with who recorded and who confirmed it.
- API: `GET/POST /v1/projects/:id/payments`, `POST …/payments/uploads`,
  `POST …/payments/:paymentId/verify` (`{ decision: settle|dispute, note? }`, If-Match) and `…/cancel`.

## Money screen (Phase 4)

The demo Money screens are replaced by real ones (spec §4.4, §36.1). Everything is computed from
records: the agreement, claims, the owner's answers, confirmed payments and the spending ledger.
Contractor internal costs never appear.

- **Per project** (phone: the Money tab for the chosen project; web: `/projects/:id/money`):
  "Owed to you now" (contractor side) or "You owe now" (client side); agreed contract, paid
  (confirmed only), approved not paid, waiting for a decision, still to come (contract − paid −
  approved, the same figure as the **contract bar**); payments waiting for confirmation and
  advances; **Waiting on you** (claims to decide, payments to confirm, spending requests to decide,
  receipts missing), each a link to where it is done; every claim with its **step tracker**
  (requested → approved → paid, with dates; a red flag where it was sent back, rejected or a
  payment disputed); the latest payments; the cost + fee line (spent · reserved of the budget).
- **Across projects** (web: sidebar Money, `/money`; phone: "Across your projects" on the Money tab):
  owed to you, you owe, waiting for a decision and confirmation, what waits on you, and one row
  per project.
- API: `GET /v1/projects/:id/money` and `GET /v1/money`.

## Budget changes (Phase 4)

The approved budget is the agreement, and it is never edited in place (spec §2 A0, §6.1, §7).
Phone: Money → Budget changes; web: `/projects/:id/changes` (linked from the Money page).

- **Propose (contractor side):** a category (owner request, unforeseen conditions, specification
  change, quantity correction), what changes and why, schedule impact in days, evidence files, and
  lines that add to or remove from existing packages or add a **new package** (fixed price or
  cost + fee). Numbered `CH-YYYY-NNNN`.
- **Floors:** a package cannot go below what is already claimed on it (fixed price) or spent and
  reserved (cost + fee, fee included); checked when sent and again at approval.
- **Approve (owner or delegate):** on the exact net change (`If-Match` + `netDelta`). Approval applies
  it in one transaction: **agreement version N+1** with the new package amounts and contract value
  (the project's contract value follows); the old version is kept. The unique version index makes
  a second application impossible. A change written on an older version is **out of date** and
  must be saved again on the current one. Rejections need a reason. Answers are append-only.
- **History:** per package the original amount (from the accepted quote), approved changes and the
  current amount, with totals; the agreement history names the change behind each version.
- API: `GET/POST /v1/projects/:id/changes`, `POST …/changes/uploads`, `GET/PUT …/changes/:changeId`,
  `POST …/:changeId/submit`, `/decision` (`{ decision, netDelta, note? }`) and `/withdraw`.

## Financial tests (Phase 4)

`apps/api/test/finance.e2e-spec.ts` (spec §24.3, A0) runs against the real API and database:

- **The worked example in A0 terms** (approved request → direct expense; orders come in A1): a
  1,000,000 cement cost budget; approving 600,000 reserves it (headroom 400,000); a 300,000
  expense posts cost and converts that much of the reservation (headroom stays 400,000); a
  200,000 payment is cash paid only once verified and never changes posted cost (SP09, recorded by
  finance as an advance); closing releases 300,000 (headroom 700,000), and a second close changes
  nothing. A retried expense with the same Idempotency-Key is replayed, not posted twice.
- **Races:** three 400,000 approvals against a 1,000,000 budget (exactly two reserve); two expenses
  for one reservation (one posts); two 10 m claims under an 18 m fixed price (one fits); two 6 m
  payments on a 10 m claim (one is recorded); a double tap with one key (recorded once).
- **Repeated requests and corrections:** the same key replays spending requests, claims and budget
  changes (a different body is refused); an approved claim corrected to a lower amount counts once
  at the new amount; disputed and withdrawn payments never count as paid; over-allocation of
  payments and expenses is refused; the same supplier invoice on two expenses is flagged.
- **Rounding:** each line is rounded to the franc, then added (1.5 × 3 twice is 10, not 9); the
  server recalculates whatever total the client sends. A0 is single-currency (RWF); other
  currencies and orders, invoices, credits, retention and refunds arrive with their modules.

## Weekly report (Phase 5)

One tap makes the week's report from what is recorded (spec §14, §15, A0). Phone: More → Weekly
reports; web: `/projects/:id/reports` (linked from each project card).

- **Generate (contractor, manager or site supervisor):** freezes a snapshot of the week (Monday to
  Sunday): accepted and reported progress, with the change in accepted points since the last report;
  the tower; contract money (paid, approved, waiting, being confirmed) and the cost + fee line; the
  week's site updates, authors, stages worked and blockers; up to 4 photos; what waits for a
  decision and for how long; the stages not started yet, by planned start. Later records never
  change a report. Generating the same week again makes **revision 2**; the list shows the latest.
- **Money is hidden** from members who may not see it (a site supervisor without financial
  visibility), even though the snapshot holds it.
- **Mark as reviewed (owner or delegate):** recorded once, with who and when.
- **PDF:** one A4 page in the reader's language: ring, tower, money bar, the week, photos,
  decisions and what comes next. Served by a 5-minute link.
- API: `GET/POST /v1/projects/:id/reports`, `GET …/reports/:reportId`, `POST …/:reportId/acknowledge`,
  `POST …/:reportId/pdf`.

## Sharing a report outside the project (Phase 5)

A limited link for family abroad, a lender or anyone without an account (spec §26.5, §12). Phone:
the report → Share; web: the "Share this report" panel on the report page.

- **Choose:** progress and the stage tower are always shown; add this week's work and blockers,
  photos, what waits for a decision, coming next, and money (only if you can see money yourself).
  The link works for 1, 7 or 30 days; the PDF download is optional.
- **Privacy preview:** before the link exists, the server returns exactly what it will show.
  A link never shows people's names (the sharer's name and the organization excepted), the exact
  place (district only), original photos (thumbnails with metadata stripped) or private costs.
  Amounts appear only with the money section.
- **Send:** the phone's share menu (WhatsApp, SMS, email…), a direct WhatsApp button, or copy.
  The link is `WEB_APP_URL/s/<token>`; only a hash of the token is stored, so the link is shown once.
- **Control:** every link lists who made it, when it stops and how often it was opened. The sharer
  or the owner can stop it at once; expired and stopped links answer "This link no longer works" (410).
  Who shares: owner, delegate, contractor, project manager (not the site supervisor).
- API: `GET/POST /v1/projects/:id/reports/:reportId/shares`, `POST …/shares/preview`,
  `POST …/shares/:shareId/revoke`; public `GET /v1/shared/reports/:token` and
  `POST /v1/shared/reports/:token/pdf?lang=rw`.

## Notifications and push (Phase 5)

What needs someone reaches them, linked to the exact item (spec §9.4, §5).

- **Events:** a payment claim, spending request or budget change waiting for a decision (to the
  owner and delegate); a new weekly report (to every member but its author); a site update with a
  blocker (to owner, delegate, contractor and manager, not its author). One notification per person
  per event, even when the job is retried.
- **Text:** in each reader's language, with the project, number or stage, never amounts or
  addresses (safe on a lock screen). Once a claim, request or change is decided, its notification
  reads itself for everyone.
- **In the app:** phone More → Notifications; web sidebar Notifications with the unread count.
  Opening one marks it read and goes straight to the claim, request, change, report or stage.
- **Push:** the phone registers its Expo push token after sign-in (and removes it on sign-out);
  tapping a push opens the item. Each notification records `sent`, `no_device` or `failed`; a failed
  push never changes the workflow, and a token Expo reports as gone is switched off.
  `PUSH_PROVIDER=console` (default) prints pushes in the API log; `PUSH_PROVIDER=expo` sends through
  Expo (required in production; `EXPO_ACCESS_TOKEN` if enhanced push security is on).
  **Real pushes need an EAS project id** (`extra.eas.projectId` in `app.json`, set by `eas init`) and
  a development or store build; Expo Go and the web build skip registration.
- API: `GET /v1/notifications`, `POST /v1/notifications/:id/read`, `POST /v1/notifications/read-all`,
  `POST /v1/me/push-devices`, `POST /v1/me/push-devices/remove`.

## Decision inbox on Home (Phase 5)

The first thing on Home, on the phone and the web: everything waiting on me across all my
projects, oldest first, with "Oldest waiting N days" (spec §4.2, §5). One tap opens the screen
where it is decided; with nothing to decide, Home shows my next action as before.

- **What appears:** a project to accept (owner), quotes to answer, stages to review (owner,
  delegate); payment claims, spending requests and budget changes (the client side only); payments
  to confirm (finance, or the side that did not record it, never the recorder); receipts to check
  (owner, delegate or finance, never the person who captured it). Each kind follows the same rule
  as the screen where it is decided, so nothing shows that the person cannot act on.
- **Late:** anything waiting more than 2 days is marked (white on the orange card).
- **Counts:** the phone's Home tab and the web's Overview link carry the number waiting.
- API: `GET /v1/decisions` (`count`, `oldestSince`, `items` with kind, project, title, amount, since,
  path).

## Reminders and quiet hours (Phase 5)

- **Daily reminder:** when decisions have waited more than 2 days, one notification a day (the
  person's local day) says how many and how long the oldest has waited, and opens Home with the
  inbox. Never more than once a day, even with several API workers (a unique per-person-per-day key).
- **Quiet hours:** default 21:00–07:00 (Kigali time). During them, pushes are held: the in-app list
  has them at once, the phone gets them when quiet hours end. No reminder is sent during them.
- **Settings:** phone and web Notifications → Notification settings: the daily reminder on or off,
  quiet hours on or off with their start and end. Saved as you change them.
- **Lock screens:** push text never carries amounts or addresses (checked by the tests on every push).
- **How it runs:** the API process that runs jobs (`JOBS_ENABLED=true`) sweeps every 10 minutes:
  it releases held pushes and sends due reminders.
- API: `GET/PUT /v1/me/notification-settings` (`remindersEnabled`, `quietHours: { start, end } | null`).
- The database pool now survives a dropped idle connection (sleep, restart) instead of crashing the API.

## Exports (Phase 5)

A project summary and the money history, as PDF or CSV (spec §12, §21). Web: `/projects/:id/exports`
(project cards, and the project Money page); phone: More → Exports.

- **Project summary:** status, place, progress, every stage (weight, status, planned dates), the
  team; with money access also the contract figures, the cost + fee line and every agreement
  version. Without money access (a site supervisor) the money is left out, and the page says so.
- **Money history:** every agreement version, claim sent and answered, spending answer, expense,
  payment recorded and confirmed or disputed, and budget change, oldest first, with who did it.
  Only for people who can see the project's money.
- **How it is made:** asking queues a background job that reads everything in one repeatable-read
  snapshot, writes the file in the requester's language (dates in the project's time zone), and
  keeps it in private storage. The page shows "Being made…" until it is ready.
- **Privacy:** only the person who asked can download (5-minute link); money access is checked
  again at download time; requests and downloads are in the audit trail; at most 10 exports per
  person per hour.
- **CSV:** UTF-8 with a BOM so Excel shows accents; amounts as plain numbers; any text that a
  spreadsheet would run as a formula (`=`, `+`, `-`, `@`) is kept as text.
- API: `GET/POST /v1/projects/:id/exports`, `POST /v1/projects/:id/exports/:exportId/download`.

## Permission tests across every endpoint (Phase 6)

`apps/api/test/permissions.e2e-spec.ts` builds a project with something real behind every id (quote,
claim, spending request, expense and receipt, payment, budget change, report and share link, export,
pending invitation) and discovers every route, so new endpoints are covered without editing the test:

- **Strangers with the real ids** get 404 on all 80+ project and organization routes, and the error
  never names the project.
- **Another project's members** who put project A's claim, payment, report… ids into their own
  project's paths get nothing back from A.
- **Money stays with money readers:** a site supervisor and a viewer read every page of the project,
  and no amount from its money records appears anywhere.
- **A viewer changes nothing** except asking for a project summary export and opening the report PDF.
- **A removed member** loses every page at once; an invitation opens only for its recipient (others
  get a masked hint).
- **Files** open only through signed, short-lived links (no signature, a tampered one or bucket
  listing: refused); exports and share links stay with the people they belong to.

Who sees money (one rule, `seesMoney` in `src/projects/access.service.ts`): the owner, anyone given
financial visibility, and the contractor, project manager and finance roles. For everyone else the
contract value is empty, quotes and agreement versions are refused (403), and report amounts are
left out. `ProjectSummary` and the overview carry `seesMoney`, so the apps hide money cards and links.

## Offline tests (Phase 6)

The phone's send step lives in `apps/mobile/src/lib/outbox-core.ts` (`sendItem`, with the API and
storage passed in), so the app and the tests run the same code.

- **Queue scenarios** (`outbox-scenarios.test.ts`, against a fake server that replays Idempotency-Keys
  like the real one): the connection drops halfway through the photos (the uploaded one is kept;
  after a restart only the rest is sent); a lost reply (the retry replays under the same key: one
  update on the server, no photo uploaded twice); a removed member or a role that may not report
  (stops, keeps everything, says "no access"); the project changed meanwhile (a "conflict" that
  can be sent again under a new key); uploads expired while offline (photos uploaded again under a
  new key, attention after 3 tries); an expired session and server errors (retries with growing
  pauses).
- **Server side** (`updates.e2e-spec.ts`, "offline arrivals"): a late update keeps the work day and
  photo time from the phone; a resend under the same key returns the same update; racing copies
  store one; an edited copy under the old key is refused; foreign or vanished uploads come back as
  `photos.N` (the queue uploads again); a paused project is a conflict; a signed-out session's
  tokens stop working; a removed member gets 404 and a non-reporter 403.
- **On the phone:** failed items in the Outbox say why in the person's language (no access,
  conflict, not accepted) with the server's words underneath, and a conflict has "Send again".
  Nothing written is deleted unless the person deletes it.

## Accessibility (Phase 6)

- **Contrast** (`packages/ui/src/contrast.test.ts`): every text colour on every background reaches
  4.5:1 (WCAG AA), and focus rings, chart marks, field outlines and placeholders 3:1, in light and
  dark. The check found and fixed: the "reported" blue, the light focus ring and accent (now
  `#C2410C` / `#EA580C`), field outlines and placeholders.
- **Browser audit** (axe-core, WCAG 2.0–2.2 A/AA): 14 web pages and 13 phone screens, no
  violations. Fixed on the way: radios and checkboxes now announce checked/unchecked on every
  platform (`aria-checked`; react-native-web ignores `accessibilityState`), sliders report their
  value, photo buttons have names, faded text on the orange inbox card is solid.
- **Screen readers:** screen and section titles are headings; error messages are announced
  (`<Text alert>`); charts carry their sentence ("40% accepted…").
- **Touch targets:** every tappable element on the phone screens is at least 44 px (chips, the
  Outbox link, "See all", the stage chip, the phone-number and amount fields).
- **200% text:** the web pages reflow at 200% zoom with no sideways scrolling; on the phone, badges,
  fields and buttons grow with the system font size instead of clipping.
- Still to do on a real phone: a TalkBack/VoiceOver pass and the system font at 200%.

## Start-up performance (Phase 6, to finish on the reference phone)

Goal: Home in under 2 seconds from the phone's saved copy on a cheap Android phone.

- **Cache first:** with a saved session and profile the app opens at once and refreshes the session
  in the background (before, it waited for two network round trips, which on a slow connection
  could take many seconds). Only a 401 from the server signs the person out.
- **Smaller app:** `apps/mobile/babel/lucide-per-icon.js` turns icon imports into per-icon imports
  (Metro does not drop unused exports): 1,869 → 79 icon files, JavaScript 4.7 → 2.6 MB.
  Next candidate: zod (~0.8 MB) comes in through `@jengalink/contracts`; a schema-free entry for the
  app would remove it.
- **Lost refresh replies:** an app closed during a token refresh on a slow network used to be signed
  out on its next start (reuse detection). The token before the last rotation now works once more
  for 2 minutes; anything older is still treated as theft.
- **Database:** a connection dropping while in use no longer crashes the API.
- **Measuring:** More shows "Home opened in X s after start" on the phone itself. On this PC (web
  build, no CPU throttle, offline) Home is ready in about 0.8 s; throttled numbers are unreliable
  while other services keep the CPU at 100%.

## Security review (Phase 6)

What was reviewed, and what changed:

- **Sign-in:** codes are random (`crypto.randomInt`), hashed with a pepper, 5 minutes, 5 tries; a
  60 s resend delay, 5 codes per number and 20 per network an hour. New: at most 30 code checks per
  network per 10 minutes and 120 session refreshes per network per 10 minutes. Refresh tokens rotate
  with theft detection (2-minute grace for a lost reply).
- **Rate limits** (`src/common/rate-limit.ts`, counted in Postgres so every server shares them):
  upload links 120 per person per hour across all upload routes; shared report links 120 per
  network per 10 minutes; exports 10 per person per hour. Over a limit: 429 with `Retry-After`.
  `RATE_LIMITS=off` only for automated tests; staging and production refuse to start without them.
- **Behind a proxy:** `TRUST_PROXY=<hops>` so limits and the audit trail see the real address.
- **Browsers:** the API answers only the web app's origin (`CORS_ORIGINS`, default `WEB_APP_URL`;
  local previews only in development). Every response carries `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, a deny-all CSP and, when hosted, HSTS.
- **Web app:** a Content-Security-Policy (own scripts only; API, storage and error tracking for
  connections) and `no-referrer`, so share-link tokens never leave in a Referer header. Set
  `VITE_API_URL` and `VITE_STORAGE_URL` at build time; hosting should also send the policy as a header
  with `frame-ancestors 'none'`.
- **Secrets in a vault:** any of `DATABASE_URL`, `JWT_SECRET`, `OTP_PEPPER`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `EXPO_ACCESS_TOKEN`, `SENTRY_DSN` can come from a file (`JWT_SECRET_FILE=…`),
  as Docker/Kubernetes secrets and cloud secret managers provide them. Staging and production refuse
  development values, a shared JWT secret and pepper, plain-http web URLs and missing limits. `.env`
  files are git-ignored; only `.env.example` (no secrets) is kept.
- **Already in place and re-checked:** deny-by-default auth guard; access checked before input; 404
  for anything not yours; money visible only to money readers; append-only financial records;
  idempotency keys scoped per person; Zod validation everywhere (unknown fields dropped); private
  storage with 5-minute signed links; virus scan required in production; CSV formula guard; log
  redaction; dependency audit (two dev-tool advisories inside Expo's CLI are ignored on purpose).
- **Open:** fonts load from Google Fonts (self-hosting them avoids sending visitors' addresses to
  Google); choosing the actual vault depends on the hosting decision (Phase 6).

## Home, progress, stage review and all projects

- **Progress from real stages** (`GET /v1/projects/:id/progress`): the ring's big number is the
  weight of **accepted** stages only; stages **ready for review** are drawn light as "reported".
  Money spent never counts. The Jenga tower shows each stage as planned, in progress (work
  reported), **blocked** (its latest update reports a blocker), ready for review, changes required,
  or accepted. Tap a block to open the stage. The rules live in
  `packages/contracts/src/progress.ts` (tested).
- **Home** (phone Home tab; web `/`) for the chosen project: what needs you first. Owners see
  "Foundation is ready for your review" with a Review button. Everyone else sees **one next
  action**. Then progress, a **money placeholder** (the agreed contract value; claims and payments
  come in Phase 4), latest photos, and blockers. The old demo overview moved to `/demo` on the web.
- **Stage review** (on the stage timeline): the contractor or manager taps **Mark ready for
  review** (needs at least one site update as evidence). The owner then **slides to accept** (web:
  a confirm dialog) the exact stage revision (`If-Match`), or **asks for changes** with a note.
  The contractor sees the note, fixes, and submits again. Every step is kept in `stage_reviews`
  (append-only, with the checks as they stood) and the audit trail.
  API: `POST /v1/projects/:id/stages/:stageId/submit` and `.../review`.
- **All projects** (phone: Home → "All projects", or More; web: Your projects;
  `GET /v1/overview`): every project with its ring, status, last update, stages waiting for review,
  **blockers**, and the **next action** for your role, such as review a stage, invite the owner,
  finish the plan, fix the owner's requested changes, clear a blocker, or post an update (none in
  3 days). Projects needing something come first.
- Both apps now share **one token refresh at a time**: refresh tokens are single-use, and two
  parallel refreshes looked like theft to the server and ended the session.

## Owner accepts the project

Only the owner starts a project, by accepting it (the old `/activate` route is gone). After joining,
the owner gets **Review the project** (also More → Your projects → Review and accept on the phone,
and on the web **Your projects**). The review shows the contract value, every stage with its
share, dates and checks, and "What accepting means" in plain words.

- **Accept:** a slide on the phone ("Slide to accept RWF 45,000,000"), a confirm dialog on the web.
  The project becomes **Active** and the plan locks as the agreed baseline.
- **Ask for changes:** the owner writes what should change. The project stays a draft; the
  contractor sees the note at the top of the plan, edits it, and the owner reviews again.
- The decision applies to the exact version the owner saw (`If-Match`); if the plan changed
  meanwhile, they are asked to look at the new version first.
- It can't be accepted until there is at least one stage and an agreed contract value (the value
  is now edited on the plan screen).
- Every decision is kept in `project_acceptances` with a copy of the value and stages as they
  were (append-only; the database rejects edits), plus the audit trail and a `project.decided`
  outbox event for later notifications.

Endpoints: `GET /v1/projects/:id/acceptance`, `POST /v1/projects/:id/acceptance`
(`{ decision: 'accept' | 'request_changes', note? }`, owner only). `PUT /v1/projects/:id/plan`
now also takes `contractValue`.

## Owner invitation

After the wizard, the contractor taps **Invite the owner** (also in More, or at
`/projects/:id/invite` on the web, while the project has no owner). Before asking for a phone
number or email, the screen says in plain words what the owner will **see** (stage progress and
photos, stages and shares, contract value and money records), what they will **approve** (contract
value and starting budget, each stage, payment requests and changes) and what **stays the same**
(the company's other projects stay private; JengaLink never moves money). After sending, the
contractor can share the link (WhatsApp, copy) or withdraw it while it is pending.

The owner opens the link (`/invite/<token>`; sign-in first, then straight back), or finds it under
More → Invitations on the phone and **Invitations** on the web. They see who invites them, the
project's type, site, contract value and stage count, and the same three blocks written for them
("What you will approve", "You stay in control"), then **Accept and join** or **Decline**.
Other roles get one plain sentence instead (this project only, with or without the money records).

- Only the person it was sent to can open it; anyone else is told which masked number or email
  it was sent to. It expires after 7 days.
- Accepting as owner raises the project's revision (its ETag changes). API responses carry
  `Cache-Control: no-store`, so browsers never reuse a stale project.

Endpoints: `GET /v1/projects/:id/invitations` (owner, manager, contractor), `GET /v1/invitations/:id`
(recipient only); the invitation view now includes `project` (type, status, value, stage count,
district, province), `organizationKind` and `financialVisibility`.

## Security checks and audit trail

- **Every endpoint is covered by a test** (`apps/api/test/security.e2e-spec.ts`) that discovers all routes:
  each non-public route must return 401 without a session, every project/organization route must return
  404 to a signed-in stranger, and the public routes must be exactly `GET /health` and the three sign-in
  routes. Adding an endpoint is checked automatically; adding a public one means updating that list on purpose.
- **Audit trail:** sign-in/out, session revocation, token theft, profile changes, organization and project
  creation, activation, invitations and member removal are written to `audit_events` in the same
  transaction, with actor, session, IP and request id. A database trigger rejects UPDATE and DELETE.
  Contacts are masked; codes and tokens are never stored. Owners read it at `GET /v1/projects/:id/audit`.
- **Errors** follow one shape: `{ statusCode, code, message, fieldErrors, requestId, retryable }`; every
  response has an `x-request-id` header to quote when reporting a problem.

## Safe writes

- **Idempotency-Key** (`@Idempotent()`): a retry with the same key and body returns the original response
  (`Idempotent-Replayed: true`) instead of acting twice; the same key with another body is 409. Required where a
  retry could cause a second effect (invitations send an SMS; later: approvals and payment records), optional
  on creating organizations and projects. Keys are per user and route, kept 7 days; a failed request frees its key.
- **ETag / If-Match**: changeable records return `ETag: "<revision>"`; `PATCH /v1/me` and
  `POST /v1/projects/:id/activate` need `If-Match`. A stale version gets 412, a missing one 428, and two
  simultaneous edits of the same version cannot both win.

**Money:** JengaLink never moves construction money. Owners pay contractors outside the app (MoMo, bank,
cash); the app records claims, approvals and payment evidence, and marks a payment Paid once verified.
The only payments through the app are JengaLink subscriptions.

## Languages

Four languages: **English, Kinyarwanda, French and Swahili** (`packages/i18n`). English is the source catalog;
the others must have exactly the same keys and `{placeholders}` (a test enforces it), and anything missing falls
back to English. `rw`, `fr` and `sw` are **drafts awaiting native-speaker review** (`meta.reviewed: false`, shown
in the language picker).

- Screens use `const { t, locale } = useI18n()`; keys are type-checked (`t('auth.sendCode')`).
- The language is the user's profile setting, else the device's last choice, else the phone/browser language.
  Switch it in More → Language (mobile), the sidebar or the sign-in page (web). It follows the account across devices.
- The API sends the sign-in code and invitation SMS/email in the person's language. User-written content
  (notes, stage names) is never translated automatically.
- Money is written "RWF 1,500,000" in every language.

## API contract (OpenAPI) and typed client

- Request and response shapes are Zod schemas in `packages/contracts`; the API validates with them and the
  TypeScript types (same names) are derived from them.
- Every route declares `@Contract({ summary, body, response, … })`. `pnpm openapi` builds
  **`apps/api/openapi.json`** (OpenAPI 3.1) from the running code and generates
  `packages/contracts/src/generated/openapi.ts`. `pnpm check` fails if either is out of date, and a test
  fails if a route has no contract.
- Apps use the typed client: `createJengaClient()` from `@jengalink/contracts/client`
  (paths, bodies, headers and responses are type-checked; errors become `ApiError` with the server message).

## Screens (demo data)

The apps run on a synthetic project (`@jengalink/contracts/demo`) until the API endpoints exist.

- **Mobile** (Expo Router, `apps/mobile/src/app`): tabs Home · Updates · Money · More, plus
  `/claim/[id]` (slide to approve), `/stage/[id]`, `/update/new` (site update composer) and `/design`.
  More → "Viewing as" switches between owner, contractor and site supervisor.
- **Web** (`apps/web/src/pages`): `/` overview, `/money` (claims and payments tables, site float),
  `/money/claims/:id` (approve with confirmation), `/updates`, and `/design?section=<id>`.

## File storage

Private S3-compatible storage runs in Docker (SeaweedFS on port **8333**; MinIO no longer
publishes images). Buckets `jengalink-dev` / `jengalink-test` are created on API start.
`pnpm services:up` starts Postgres and storage together.

Flow: `storage.createUploadGrant(type)` gives the client a 10-minute signed PUT to `tmp/<uuid>`;
the server then calls `storage.promoteUpload(grant, mediaKey(org, project, id))`, which deletes
and rejects missing, empty, oversized or wrong-type files. `storage.createDownloadUrl(key)` gives a
5-minute signed GET, so check the caller's access first. To test on a phone, set `S3_PUBLIC_ENDPOINT`
to your PC's LAN address.

## Background jobs and events

Domain code records events with `recordEvent(tx, type, payload)` inside its own transaction
(transactional outbox). A relay moves them into pg-boss queues, one per consumer, and consumers
subscribe with `jobs.on(type, consumerName, handler)`. A handler runs at most once per event; if
it throws, its writes roll back and pg-boss retries (5 times, with backoff). Event types live in
`apps/api/src/jobs/events.ts`. Workers run inside the API process; set `JOBS_ENABLED=false` to turn them off.

## Logs, error tracking and demo data

The API writes one log line per request (method, path without query, status, duration, user id)
plus app messages, all tagged with the request id that error responses show to users.
`LOG_FORMAT=json` gives one JSON object per line (the default in staging/production);
`pretty` is the local default. `LOG_LEVEL` is `debug|info|warn|error`. Phone numbers, emails,
tokens and sign-in codes are masked before anything is written (`apps/api/src/observability/redact.ts`).

Error tracking uses Sentry and stays off until a DSN is set: `SENTRY_DSN` for the API,
`VITE_SENTRY_DSN` at build time for the web app. Only unexpected 5xx errors are sent, with the
request id and user id; request bodies, headers, cookies, query strings and contacts are stripped.
The web app shows a "Something went wrong / Try again" screen instead of a blank page.
Mobile error tracking comes with the custom dev build in Phase 3.

Development uses synthetic data only. `pnpm --filter @jengalink/api db:seed` creates a fictional
demo project (Kicukiro House) with test phones 0788 000 101 (owner), 102 (contractor) and
103 (supervisor); sign in with those and read the code in the API log. It is safe to run twice and
refuses to run when `APP_ENV=production`. The API also refuses to start in production with the
console code sender.

## Commands (from the repo root)

```sh
pnpm install          # install everything
pnpm check            # lint, typecheck, tests, migration check, DB tests, dependency scan (needs pnpm db:up)
pnpm build            # build all packages and apps
pnpm typecheck
pnpm openapi          # regenerate apps/api/openapi.json and the typed client after changing routes
pnpm test
pnpm --filter @jengalink/api dev      # API on http://localhost:3000
pnpm --filter @jengalink/web dev      # web on http://localhost:5173
pnpm --filter @jengalink/mobile dev   # Expo dev server (scan QR with Expo Go)
```

Requires Node 22+ and pnpm 10. `.npmrc` sets `node-linker=hoisted` because Expo needs a flat `node_modules`.
In the mobile app, add packages with `npx expo install <pkg>` so versions match the Expo SDK.

The dependency scan fails on high or critical advisories. Unpatched advisories that affect only dev tooling are listed in `pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`); review that list on every Expo SDK upgrade.
