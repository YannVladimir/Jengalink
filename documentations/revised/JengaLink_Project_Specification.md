# JengaLink Construction Project Platform

## Product and development specification

Prepared for Yann Vladimir Bajeneza and the product development team  
Version 2.0 | 8 October 2026

JengaLink is a mobile and web platform for managing construction projects remotely. It connects property owners, contractors, supervisors, suppliers, and independent inspectors around a shared record of work, spending, materials, decisions, and evidence. This document defines the complete product direction and a staged implementation plan. It gives designers, developers, testers, and operations staff a common specification for what to build and how to verify it.

Naming status: The product name is JengaLink, decided on 8 October 2026. Earlier documentation used the provisional title SiteProof, which was dropped because existing construction products already use it (references 13 and 14). Complete domain, app-store, company-name and trademark registration for JengaLink before public launch.

The central product promise is visibility and accountable collaboration. JengaLink helps customers understand what happened, what remains uncertain, and what requires their decision. A receipt, location tag, photograph, or approval is evidence of a particular action; none is automatically proof of structural quality, ownership, honesty, or regulatory approval. Technical certification remains the responsibility of appropriately qualified professionals.

All business rules, service targets, and sample prices in this specification are proposed product defaults. They are implementation requirements for this version unless replaced by a documented product decision. Technology choices are recommendations rather than commitments to a particular vendor or framework release.

## 1 Product purpose and business value

### 1.1 The problem

Construction information is often divided between phone calls, spreadsheets, paper receipts, and messaging threads. An owner may see progress photos without knowing which stage they show, receive a payment request without a clear breakdown, or discover a delay after it has affected several other activities. A contractor can also struggle to demonstrate completed work or establish that the client approved a change.

JengaLink creates a project record that ties information together. An approved budget line connects to a spending request, a purchase order, a supplier invoice, a delivery, and the construction stage it supports. A progress update connects to tasks, evidence, defects, and acceptance decisions. Users can follow these relationships without navigating separate tools.

### 1.2 Customers and benefits

| Customer | Primary need | Benefit to deliver |
|---|---|---|
| Owner living abroad | Monitor a project without constant site visits | Clear reports, controlled approvals, and access to independent inspection |
| Local busy owner | Know what needs attention | Prioritized decisions and a dependable project overview |
| Contractor | Coordinate work and communicate professionally | Recorded instructions, faster approval tracking, and client reports |
| Supervisor | Record site activity with little administration | Fast mobile reporting and searchable material and task records |
| Inspector | Organize bookings and findings | Structured checklists, evidence, corrective actions, and report delivery |
| Supplier | Respond to orders and confirm deliveries | Clear quantities, accepted quotations, and delivery confirmation |
| Property developer company | Manage several construction projects | Portfolio visibility, shared team administration, and project comparison |

### 1.3 Business value for the platform developer

The platform can earn recurring revenue from project subscriptions and company plans, with additional revenue from optional inspection coordination and setup services. The useful asset is a reliable workflow and trusted operational network, rather than simply a collection of forms. The product should reduce the effort required to report and review construction so that customers keep using it throughout the project.

Potential differentiation is the combination of simple site reporting, traceable spending, independently reviewed milestones, and low connectivity support. This is a positioning hypothesis to test with customers, not a claim that competitors lack these capabilities.

### 1.4 Measures of success

Measure activation as a project with an invited site reporter, an approved initial budget, and its first submitted update. Track weekly reporting coverage, median approval turnaround, unresolved defects, report downloads, repeat contractor projects, paid conversion, cancellation reasons, and support cost per active project. Track outcomes against agreed project plans; do not market a reduction in fraud or construction costs without evidence from a suitable evaluation.

The pilot should answer three questions: do owners receive information they can act on, do site teams submit updates consistently, and will the payer continue paying after the initial trial? A proposed pilot is three real projects over six to eight weeks, followed by a review of usage and interviews with each role.

## 2 Scope and release strategy

The complete product includes all modules in this document. Release stages define implementation order, not removal of requested features. Every later module must have a documented domain contract and integration boundary. Build physical tables when needed by an implemented workflow rather than deploying unused financial machinery, but incomplete modules must not appear as working controls in the customer interface.

| Release | Included capability | Exit condition |
|---|---|---|
| A0 Pilot | Phone-first identity, scoped invitations, stages, approved budget, offline photo updates, requests and approvals, direct expenses, payment records, petty cash, wage batches, basic foreign funding records, receipts and weekly PDF reports | Pilot tests in section 32 pass; owners and site reporters complete the workflow without coaching |
| A1 Formal procurement | Purchase orders, supplier invoice submission and finance posting, partial deliveries, basic approved budget changes, equipment hire, document versions and expanded notifications | The full procurement financial example in section 6.7 passes; no duplicate cost, reservation or payment |
| B Reliable operations | Full material ledger, advanced change orders and dependencies, inspections, defects, disputes, handover, portfolio and automated subscription billing | Operational workflows pass end to end and independent inspection partners are ready |
| C Connected services | Supplier and inspector discovery, quotations marketplace, provider-mediated construction payments, WhatsApp Business notifications, scoped sharing and advanced analytics | Partner operations, channel permissions and provider reconciliation pass readiness review |
| D Assisted workflows | OCR, draft transcription, source-linked summaries, anomaly suggestions and optional model viewing | Human review and evaluation demonstrate usefulness within the stated scope |

A0 is the build plan for the first pilot; the complete product remains the long-term scope. A0 uses an approved request that reserves budget, followed by an authorized direct expense that converts the reservation into cost. It has no customer-facing purchase order or supplier invoice workflow. A1 introduces those workflows and is the release required to pass the purchase-order example in section 6.7.

Budget changes exist from A0: propose a delta to named lines, describe the reason, obtain the owner's approval, and create a new immutable budget version. A0 does not silently edit the approved budget. A1 adds procurement amendments; B adds the complete change-order process with drawings, dependencies and professional review. Offline capture is in A0, but posting, approval and reconciliation remain server-validated online.

Inspectors can be booked manually during A0 and their reports uploaded. Internal booking and structured inspection arrive in B; public discovery arrives in C. Pilot subscription collection can be invoiced and reconciled manually. Customer access changes only after authorized confirmation; a screenshot or client success page cannot activate a paid entitlement.

### 2.1 Boundaries

JengaLink is not a structural design authority, statutory permitting system, land registry, banking service, or automatic fraud detector. It stores permits and professional reports and tracks their review status. Funds movement, financing, and escrow must use appropriate external partners and a separately approved operational model. Initial releases record external construction payments; pilot subscription collection may be manual, with automated provider billing introduced later; they do not hold construction funds.

### 2.2 Missing workflows added to the original idea

The original concept covered progress, budgets, receipts, approvals, and inspections. A usable construction product also needs versioned budget changes, partial deliveries, returns, stock counts, rejected work, dependencies, payment reconciliation, contractor replacement, role revocation, disputed records, evidence revisions, document versions, handover, warranties, and offline conflicts. These workflows are specified below so that the product behaves predictably when a project departs from its initial plan.

## 3 Accounts roles and permissions

### 3.1 Account and organization model

A user has one identity and can belong to several organizations and projects. An organization represents a household project workspace, contractor company, developer company, supplier, or inspection business. Each project belongs to one managing organization. External contractors, inspectors, and owners receive project memberships; membership in their own company does not grant access to a client's other projects.

Organization administrators manage their organization and invitations. They cannot automatically approve client spending or view all project financial data. Project permissions require explicit project membership. The initial household workspace creates the payer as the initial project owner. A contractor-created client project must obtain the client's accepted owner invitation before activating approvals.

### 3.2 Role definitions

Project Owner sets project policies, approves the budget, and appoints reviewers. Owner Delegate acts only within assigned permissions, amount limits, and effective dates. Project Manager plans stages and coordinates the team. Contractor submits work and procurement requests. Supervisor records site activity and deliveries. Finance Officer verifies invoices and records payments. Inspector reviews assigned inspection scopes. Supplier accesses only its quotations, orders, delivery submissions and supplier invoice submissions. Viewer reads explicitly permitted project sections. Platform Administrator manages platform operations through audited access, not routine unrestricted access to customer content.

| Role | Can create or submit | Can decide or post | Visibility |
|---|---|---|---|
| Owner | Project policies and team invitations | Budget, spending and milestone acceptance within policy | Own project; finance visibility explicitly configured |
| Delegate | Only assigned actions | Only within scope, amount cap and validity | Granted project sections |
| Manager | Plans, tasks, proposed changes and updates | Delegated decisions only | Assigned project sections |
| Contractor | Procurement requests, proposed changes, work and wage submissions | Cannot approve own submissions or accept own work | Assigned work and permitted finances |
| Supervisor | Daily updates, attendance, delivery and usage records | Receipt confirmation when authorized; no spending approval by default | Assigned site scope |
| Finance officer | Invoices, expenses, funding and payment records | Verify and post authorized records; delegated approval only | Financial scope and supporting evidence |
| Inspector | Assigned inspection report and findings | Sign own report and verify assigned corrections | Inspection scope and required project evidence |
| Supplier | Own quotation, delivery and invoice submissions | Confirm own order terms; cannot post project cost | Own orders, invoices and related delivery records |
| Viewer | No writes | No decisions | Explicitly permitted read-only sections |
| Platform operations | Support cases and partner administration | Operational actions within audited grants | Minimum required scope |

Owner Delegates inherit only explicit grants, not the entire Owner role. Viewers are read only and financial visibility is separately granted. One user may hold several roles, but conflict rules still prevent approving their own spending submission or independently inspecting their own work. A sole-owner exception for self-entered administrative records requires a visible reason and a distinct label; it does not count as independent review.

### 3.3 Authorization rules

Evaluate permissions on the server for every request using user identity, active project membership, action grant, resource scope, record state, and approval policy. Do not trust a role value or project ID supplied by a client. A user knowing another project's UUID must not be able to read, download, export, update, or discover its records.

Invitations expire after seven days by default and are bound to an email or phone verified by the recipient. Revocation takes effect immediately on server requests and cancels pending approvals assigned to the revoked user. Offline data cannot be remotely guaranteed erased from a disconnected device; limit caching and wipe the application cache when the device reconnects or the session ends. Reassign outstanding tasks and approval steps explicitly rather than silently skipping them.

Platform support access requires a reason, time limit, and audit event. Prefer customer-approved access for ordinary support. Emergency access must be separately controlled and reviewed. Supplier and inspector access expires at the end of the assignment unless the owner renews it.

## 4 Modern user experience and navigation

### 4.1 Design principles

Every screen should answer what happened, what needs action, and what the user can do next. Use plain language such as Request approval, Record delivery, and Submit site update. Display progress, financial approval, inspection status, and payment status separately. A green approval badge must never imply that money was paid or that construction was certified.

Use progressive disclosure: a short initial form with optional detailed fields behind an expansion. Avoid making owners learn construction terminology before they can review an update. Explain terms such as committed cost, retention, and change order inline. Provide English and Kinyarwanda first, with French and Swahili as planned language packs. Translate product labels and notifications; user-generated text remains in its source language unless the user requests a clearly labeled translation.

### 4.2 Mobile navigation

Use five primary destinations: Home, Projects, Inbox, Activity, and Account. Home shows the active project summary, pending decisions, latest update, next milestone, and connectivity status. Projects lists accessible projects with search and archive filters. Inbox groups approvals, tasks, inspection requests, and mentions. Activity shows a chronological project feed with category filters. Account contains profile, language, organization switching, subscriptions, downloads, and support.

Inside a project, use Overview, Work, Money, Materials, and More. Work contains stages, tasks, site updates, inspections, and defects. Money contains budget, requests, orders, invoices, payments, and changes. Materials contains deliveries, usage, counts, and returns. More contains team, documents, reports, project settings, and handover. A contextual Add button opens role-appropriate shortcuts. Suppliers receive a simpler Orders workspace, not the full owner interface.

### 4.3 Web navigation

Use a left sidebar with Portfolio, Projects, Inbox, Reports, Partners, Billing, and Settings. The project workspace has the same labels as mobile. Keep the project name and role visible, particularly when a contractor switches between clients. Advanced financial tables belong primarily on web; mobile offers clear summaries and focused approval screens.

### 4.4 Screen requirements

| Screen | Essential content | Main action |
|---|---|---|
| Project overview | Latest report date, milestone progress, budget summary, issues, decisions | Review next action |
| Spending review | Line items, quotations, budget impact, proposer, previous decisions | Approve or request changes |
| Site update composer | Stage, short description, photos, tasks, blockers | Save draft or submit |
| Material delivery | Order, quantities, condition, supplier, receiver evidence | Confirm accepted quantities |
| Inspection detail | Scope, inspector, schedule, checklist, findings, report status | Submit or review report |
| Defect detail | Location, severity, evidence, responsible party, due date | Submit correction |
| Money overview | Approved budget, posted cost, commitments, payments, outstanding | Open a clearly labeled breakdown |
| Handover | Documents, open defects, warranties, owner acknowledgement | Accept or return for correction |

### 4.5 Interaction and accessibility

Use a restrained visual system with neutral surfaces, one primary accent, and status colors accompanied by text and icons. Target at least 44 by 44 logical pixels for mobile touch controls. Support screen readers, text resizing, keyboard navigation on web, meaningful focus order, and adequate contrast. Avoid color-only distinctions and tiny financial text. Confirm approval amounts and currency immediately before submission. Destructive actions require a specific explanation and show the affected records.

Provide skeleton loading for fetched content, useful empty states, explicit permission errors, and retry controls. Display Offline draft, Waiting to upload, Submitted, and Conflict as distinct states. Never present a cached balance as live; show its last synchronization time. Notifications should link to the exact object and preserve the user's current context after review.

## 5 Project setup and planning

### 5.1 Guided setup

Create a project in a short wizard: name and project type; site location; currency and timezone; owner and team; initial stages and budget; reporting and approval policies. Allow an incomplete draft project. Activation requires an accepted owner membership, project currency, at least one stage, and an initial approval policy. Budget approval can occur immediately after activation; spending approval is blocked until an approved budget exists.

Store country and administrative location fields without hard-coding Rwanda into the database. Rwanda location entry may use province, district, sector, cell, and village. GPS and map pins are optional additions to a typed location. Project currency is immutable after financial postings; migration to another currency requires a new project or an explicit migration process. Store timestamps in UTC and render dates in the project timezone.

### 5.2 Stages tasks and dependencies

Provide editable templates for a house, renovation, apartment building, commercial building, and small civil project. Templates propose stages and checklist names, not engineering instructions. Each stage has a description, planned dates, responsible lead, measurable completion criteria, weight, dependencies, budget lines, and inspection requirements.

Tasks have an assignee, due date, status, stage, priority, attachments, and optional measured quantity. Task states are Open, In progress, Blocked, Ready for review, Completed, and Cancelled. Reject dependency cycles. A required predecessor must be accepted before a dependent stage begins unless an authorized exception records its reason. Delays require a cause, expected impact, responsible party, and revised date proposal.

### 5.3 Progress measurement

Separate reported physical progress from accepted progress. Stage progress can use completed quantity divided by planned quantity, or a reviewer-approved percentage for work that cannot be measured consistently. Overall accepted progress is the weighted sum of accepted stage percentages; stage weights total 100. Do not derive physical progress from money spent. A stage reported at 100 percent remains Ready for inspection or Ready for owner review until its acceptance requirements are satisfied.

Keep the original schedule baseline and each approved revision. Proposed revised dates do not erase the original deadline. Portfolio indicators must distinguish late against baseline from late against current approved schedule.

## 6 Budget procurement and financial control

### 6.1 Budget structure

Select the commercial basis before enabling owner financial views. Section 37 defines fixed-price, reimbursable and hybrid packages. The procurement cost examples below describe the purchasing party’s operational budget; they must not silently expose a contractor’s internal costs as the owner’s agreed contract price. Contractor internal estimates and owner financial records have separate access and totals.

The bill of quantities contains stage, cost category, description, unit, planned quantity, unit rate, tax treatment, and total. Cost categories include materials, labor, equipment hire, professional services, transport, permits, and contingency. Permit entries record costs and documents, not a claim of official validity.

Store money as integer minor units and quantities as decimal values. RWF uses whole-franc amounts in the interface; other currencies use their configured precision. Never use binary floating point for money. Define line rounding at currency precision and sum rounded lines. Store net amount, tax amount, and gross amount separately. Tax rates are explicit project inputs reviewed by finance; the app does not assume a legally correct rate.

Budget versions move through Draft, Submitted, Approved, Rejected, and Superseded. The initial approved version and all later approved changes form the current budget. Posted versions are immutable. Corrections create new versions or reversing transactions.

### 6.2 Financial definitions

| Metric | Definition |
|---|---|
| Approved budget | Initial approved gross budget plus approved change amounts |
| Posted cost | Posted supplier invoices and direct expense records less posted credit notes |
| Remaining commitments | Active approved request reservations not yet converted to orders or cost, plus un-invoiced approved order amounts; released on cancellation |
| Forecast final cost | Posted cost plus remaining commitments plus estimate to complete uncommitted work |
| Budget headroom | Approved budget less posted cost less remaining commitments |
| Outstanding invoices | Posted payable invoices less allocated settled payments and applicable credits |
| Cash paid | Settled outgoing payments less settled refunds; includes supplier advances |
| Unallocated advance | Settled payment amount not yet allocated to an invoice |

Use gross cost consistently for budget control unless a separately configured tax-recovery model is implemented. Spending approval reserves budget capacity but does not post cost or record cash payment. Requests linked to orders must convert their reservation into order commitment atomically so it is counted once. Pending requests are shown separately from approved commitments.

Never calculate actual cost by adding receipts, purchase orders, and payments. A receipt is evidence; an order is a commitment; an invoice or direct expense is a cost; a settled payment is cash movement. An invoice line reduces its linked order commitment by the same attributable gross amount. Over-invoicing requires an approved order change, not a negative remaining commitment.

### 6.3 Approval policy

The owner configures amount bands, required reviewers, quorum, sequential or parallel steps, expiry, and whether inspection is required before a related milestone payment. Use individual votes with immutable timestamps and the exact submitted revision. A submitter cannot approve their own request under ordinary policy. A delegation has a scope, cap, validity dates, and grantor; it cannot exceed the grantor's authority.

A proposed default requires one owner approval for any construction spending. Companies may enable a finance review followed by an owner approval. Changes to a submitted amount, supplier, lines, or evidence invalidate earlier votes and create a new revision. Expired or reassigned requests require new review. An approved policy change affects future submissions; applying it to open requests requires explicit reissue and audit events.

At final approval, lock affected budget rows and recheck available capacity in the same database transaction. If another approval consumed the capacity, return a conflict with updated balances. Over-budget requests require an approved change order or an explicitly configured exception with a recorded reason; they must not silently pass.

### 6.4 Procurement workflow

The contractor creates a spending request with stage, budget lines, purpose, quantities, required date, and supporting quotations. The reviewer approves, rejects, or asks for changes. An approved request can produce one or more purchase orders with allocation totals that cannot exceed the authorized amount. Supplier acceptance confirms order terms but does not alter the owner's authorization.

Quotations record supplier, currency, validity date, item specifications, quantity, unit price, delivery fee, and exclusions. Compare landed total and matching specifications rather than unit price alone. Explain that listed prices are supplier offers, not platform-verified market prices.

Purchase orders support partial delivery, partial invoicing, amendments, and cancellation of the remaining quantity. A supplier response that changes price or quantity returns the order for approval. Orders are Closed only when financial and delivery reconciliation is complete or an authorized closure records the exceptions.

### 6.5 Invoices expenses and receipts

Suppliers may submit draft invoices only against their own orders. Contractors may upload an invoice on behalf of a supplier with attribution. Finance verifies these submissions and is the only role that posts project cost under its granted permissions. Finance posts invoices against approved orders or an approved direct expense authorization. An invoice includes supplier reference, date, lines, tax fields, amount, attachments, and order allocations. Detect possible duplicate supplier references and similar amount-date combinations; a finance reviewer may override a warning with a reason. Missing receipts appear as an exception and cannot be hidden by marking the expense paid.

Correct a posted invoice with a credit note and replacement, preserving links and history. A direct cash purchase may create a direct expense and a linked payment, but each is a separate financial record. Prevent also invoicing the same expense through an order unless an explicit conversion reverses the original cost.

### 6.6 Payments advances and retention

External payment records include payer, beneficiary, amount, currency, method, reference, payment date, evidence, verification state, and invoice allocations. Recording payment evidence produces Recorded pending verification. Finance verifies an external record before it becomes Settled. Provider-mediated payments become Settled only after server-side verification with the provider. A user's screenshot cannot independently confirm provider settlement.

Support advances without inventing invoices. Later allocate the advance to posted invoices; allocations cannot exceed either available payment balance or invoice outstanding balance. Handle partial payments, refunds, failed transfers, and disputed payments. Retention is a configured contractual portion withheld from the amount payable until a release condition is approved. It remains part of cost and is shown separately as retained liability. Do not add automatic retention rules without a project agreement.

### 6.7 Worked financial example (A1 procurement)

The cement budget is 1,000,000 RWF. A 600,000 RWF order is approved, giving 600,000 RWF remaining commitments and 400,000 RWF headroom. A 300,000 RWF invoice is posted against it: posted cost becomes 300,000 RWF and remaining commitments becomes 300,000 RWF, so headroom stays 400,000 RWF. A verified 200,000 RWF payment makes cash paid 200,000 RWF and invoice outstanding 100,000 RWF. It does not change posted cost. This example must be an automated financial integration test.

## 7 Change orders and owner decisions

A change order records the reason, scope, affected drawings, proposed budget delta, schedule impact, contractor quotation, and evidence. Changes include owner design requests, unforeseen ground conditions, specification changes, or corrected quantities. The app cannot determine whether the reason is technically valid; a qualified reviewer assesses it where necessary.

States are Draft, Submitted, Under review, Approved, Rejected, Withdrawn, and Applied. Approving a change stores an immutable decision. Applying it creates a new approved budget version and any schedule or order amendments in one transaction. Approved changes must not be applied twice. If application fails, the approved record remains visibly Pending application and is retried safely.

Display the original budget, approved additions and reductions, current budget, and forecast variance. A negative change cannot reduce a budget line below posted cost plus unavoidable commitments without an explicit approved reconciliation. Changes to required quality criteria must reference a revised professional specification and cannot simply waive a critical unresolved defect.

## 8 Materials delivery usage and reconciliation

### 8.1 Material catalogue

Each project material has a name, specification, canonical unit, optional supplier SKU, storage location, and reorder threshold. Distinguish different grades and sizes. Do not combine cement bags of different weights as interchangeable units. Unit conversions are explicit, versioned, and approved before use; quantity calculations preserve precision and display the conversion used.

### 8.2 Delivery workflow

A supplier or supervisor submits a delivery against an order with quantities, delivery note, photos, time, and condition. The site receiver independently records accepted, rejected, and missing quantities. Stock increases only for accepted quantities when the receipt is confirmed. Partial receipt keeps the remaining order quantity open. A damaged delivery may be quarantined and later accepted or returned; quarantined material is not available stock.

If the same person submits and receives a delivery, show Same person confirmation. Projects can require a second receiver for selected amounts or materials. GPS is optional and its accuracy is visible. A missing location does not falsely become verified. Allow non-order deliveries such as owner-supplied material with source, value treatment, and authorization.

### 8.3 Stock movements

Record accepted receipt, issue to stage, return from stage, supplier return, transfer, waste, and stock-count adjustment. Each movement has quantity, unit, material, location, author, event time, received time, stage or order where relevant, reason, and attachments. Transfers create linked outgoing and incoming records atomically. Return quantities cannot exceed the eligible unreturned quantity.

Available stock equals accepted receipts plus returns from work plus incoming transfers, less issues, outgoing transfers, supplier returns, and approved waste, plus approved adjustments. Materials issued to a stage are no longer available stock. Waste of already-issued material is classified within that stage's usage and must not subtract site stock again. Stock counts compare expected and observed amounts; variances require review before an adjustment posts.

Do not allow negative stock silently. Offline usage is provisional until server validation. A supervisor may submit an exception request if a missing receipt caused the discrepancy, but the ledger changes only after resolution. Posted movements are immutable; corrections use linked reversal and replacement movements.

### 8.4 Alerts and responsibility

Alert for low stock, late deliveries, rejected quantities, unexplained count variance, and unusual recorded waste. These indicate records needing review, not theft. Assign each exception to a named responsible person and show how it was resolved. Export order-to-delivery and delivery-to-usage reconciliation for owners and finance.

## 9 Site reporting evidence and communication

### 9.1 Daily and weekly updates

The supervisor submits a short daily log with stages worked, tasks completed, workforce count, deliveries, weather impact if relevant, blockers, and photos. Avoid demanding every field for every update. The weekly report summarizes work, accepted progress, upcoming activities, spending, material exceptions, inspections, and decisions needed.

Each update has an author, stage, event date, submission time, revision, and media links. After submission, edits create a visible revision; authors cannot overwrite a published history. Owners can acknowledge the update or request clarification. Acknowledgement is not milestone acceptance.

### 9.2 Evidence handling

Capture optional device time, location coordinates, accuracy, camera or imported origin, and file checksum. Preserve originals privately and generate optimized viewing copies. Show server receipt time separately from claimed capture time. Mark imported files and missing metadata. Checksums support detecting file changes or exact duplicates; they do not establish truth. Location and time metadata may be inaccurate or manipulated.

Media may be submitted as Offline capture pending upload, Uploaded processing, Ready, or Failed. A financial or inspection submission requiring evidence cannot finalize until required files are Ready. Virus scan documents, validate file type from content, impose size limits, and sanitize filenames. Use signed download links with short expiry and authorization before issuance.

### 9.3 Discussion and decisions

Place comments on requests, tasks, updates, defects, and inspections so conversations remain linked to the subject. Mentions create notifications. A project discussion channel supports general coordination, with moderation and reporting. A chat message saying approved is not a financial approval; the user must use the approval action. A decision log records the decision, authority, source object, revision, rationale, and effective date.

### 9.4 Notifications

Use in-app and push notifications initially; optional email and SMS for important reminders. Configurable events include approval needed, overdue decision, new weekly report, delivery exception, inspection change, critical defect, subscription renewal, and membership change. Provide per-channel preferences, quiet hours, digest mode, and deduplication. Do not include sensitive amounts or site addresses on lock screens by default. Delivery failure should be observable to support and must not alter workflow state.

## 10 Inspections quality and safety

### 10.1 Booking and assignment

An owner requests an inspection with stage, scope, site location, preferred windows, required competence, and documents. The operations team or partner inspector confirms availability, fee, cancellation terms, and assignment. Booking states are Requested, Offered, Confirmed, In progress, Report submitted, Completed, Cancelled, and No show. Fee and refund handling follows the accepted booking terms and provider settlement records.

Track identity review, qualifications, service area, availability, conflicts, and document expiry for inspectors. A platform reviewed badge must say what was reviewed and when; it must not imply official certification. An inspector declares conflicts and cannot independently inspect their own construction work or their employer's work on that project. Exceptions are disclosed and do not receive an independent label.

### 10.2 Checklist and findings

Checklists are prepared and versioned by qualified professionals for each inspection scope. Entries have a criterion, reference, result, finding, severity, photos, and whether a qualified measurement is required. Results are Meets criterion, Does not meet criterion, Not inspected, and Not applicable. A not inspected item must not count as passing. The product must not invent technical thresholds or generate authoritative structural advice.

Inspector outcomes are Pass, Conditional pass, Fail, or Unable to assess. The report states scope, limitations, findings, competence, evidence, and follow-up requirements. Submitted reports are signed by the assigned inspector and immutable; corrections issue a superseding revision. Owner acknowledgement is stored separately from technical outcome.

### 10.3 Defects and corrective actions

Defect states are Open, Assigned, In correction, Ready for reinspection, Verified resolved, and Closed. Rejected correction returns the defect to In correction with a reason. The responsible contractor submits evidence but cannot verify their own correction when independent review is required. The owner may close administrative items only within permission; technical defects require the configured qualified reviewer.

Critical safety or quality findings block stage acceptance under project policy and cannot be dismissed by an ordinary progress edit. The interface tells users to follow the responsible professional's instructions. Incident reporting captures what happened, immediate action, affected persons with restricted visibility, evidence, and responsible follow-up. Reporting in the app is not an emergency response service; do not rely on app notification delivery for urgent safety action.

### 10.4 Acceptance rules

A stage is accepted only after required tasks are reviewed, evidence is ready, inspection requirements are satisfied, blocking defects are resolved, and an authorized owner or delegate accepts the exact stage revision. Conditional acceptance lists permitted outstanding items and deadlines. If a significant scope change occurs, acceptance requirements are reevaluated rather than silently inherited.

## 11 Documents permits and design records

Store drawings, contracts, quotations, invoices, permits, inspection reports, site photos, manuals, warranties, and handover documents with categories, versions, dates, uploader, and access scope. A drawing revision has a revision code, status, author or professional source, and Supersedes link. Clearly distinguish Draft, For review, Approved for project use, and Superseded. Approved for project use is an internal project decision, not government approval.

Tasks and change orders reference the exact drawing revision used. Warn when a task references a superseded drawing. Files cannot be overwritten in place; create a new version. Provide expiry reminders for permits or qualifications where an expiry is entered. Store official references and uploaded evidence without asserting that the platform has independently authenticated them.

Release D may link externally hosted BIM models or provide viewing integration. The integration must preserve permissions and model versions. Optional generated design previews are illustrative and cannot replace signed drawings, engineering calculations, or approved plans.

## 12 Disputes replacement and handover

### 12.1 Disputes

A participant can raise a dispute against a specific payment, delivery, approval, milestone, or inspection. Record the disputed facts, requested resolution, participants, evidence, and timeline. Statuses are Open, Response requested, Under review, Resolution proposed, Resolved, Escalated, and Withdrawn. Lock affected evidence from destructive changes while preserving the ability to append responses.

Platform support can facilitate communication and record an agreed resolution; it does not automatically adjudicate contractual rights. A dispute does not reverse posted costs or refund money by itself. Approved resolutions produce explicit corrective records. Allow access to an export for the parties within their permissions and retain legal holds where applicable.

### 12.2 Contractor replacement and project transfer

Removing a contractor preserves prior work and attribution. The owner revokes membership, reassigns open tasks, reconciles orders and payments, records stock custody, and invites the replacement. The replacement does not inherit the predecessor's approval authority. Project ownership transfer requires confirmation from the current and incoming owners, resolution of billing responsibility, and an immutable transfer record. Organization transfer requires its own migration workflow, not an editable organization ID.

### 12.3 Handover and maintenance

Create a handover checklist containing accepted milestones, unresolved nonblocking items, final account, drawings, inspection reports, manuals, warranties, supplier contacts, and asset records. Each asset may store serial number, installation date, warranty start and end, maintenance interval, installer, and supporting documents. Notify the owner before entered warranty deadlines and planned maintenance.

Owner acceptance acknowledges receipt of the listed package and does not waive undisclosed defects by default. Archive projects as read only while retaining permitted exports. Reopening work creates a new authorized stage or linked maintenance job with an explicit budget. A cancelled subscription must not erase records or block the promised export period.

## 13 Reports analytics and shared access

Provide weekly progress, financial summary, procurement reconciliation, materials reconciliation, inspection and defects, change history, audit history, and handover reports. Each report identifies project, currency, timezone, reporting period, generation time, data cutoff, author, and filter scope. Financial reports show the metric definitions used. Distinguish missing information from zero.

Exports are generated by a background job from a consistent snapshot. Permission checks occur at request time and download time. Apply field redaction for restricted roles. Shared links are disabled by default; when enabled they specify allowed sections, expiry, optional recipient verification, download permission, and revocation. Never expose an entire project through an unscoped link.

Company portfolios show projects by stage, outstanding decisions, delays, cost variance, and unresolved issues. Cross-currency portfolios show separate currency totals initially. A later conversion view must state the exchange-rate source, timestamp, and reporting currency and must not alter posted project amounts.

Owner dashboards prioritize pending decisions and trust in reporting. Supervisor dashboards prioritize today's tasks and quick capture. Contractor dashboards prioritize outstanding approvals, deliveries, and client reporting. Avoid a single crowded dashboard with every module visible to every role.

## 14 Marketplace and professional services

### 14.1 Supplier marketplace

Owners or contractors can request quotations from approved suppliers using structured specifications and delivery location. Suppliers see only their invitation and required scope, not competing confidential quotations or the full project budget. Quotations have expiry, availability timestamp, delivery terms, and currency. Accepted quotations generate authorized orders through the normal procurement rules.

Partner onboarding records business details, contacts, service areas, review status, and applicable documents. Reviews should be tied to completed transactions, moderated, and distinguish delivery service from material quality. Sponsored placement must be visibly labeled. Supplier fees and commissions must be transparent to the party paying them.

### 14.2 Inspector and contractor discovery

Filter by service area, competence, project type, availability, language, and disclosed review status. A directory profile is separate from project access. Selecting a professional creates an invitation or booking, not automatic permission to inspect all project documents. Contractors can showcase customer-authorized completed projects, with location and owner information redacted by default.

### 14.3 Service operations

An operations dashboard handles partner applications, expired documents, complaints, missed appointments, payment exceptions, and review moderation. Define response responsibilities before selling inspections. Start with a small vetted service area and expand when there is adequate partner coverage. A software listing alone cannot ensure that a professional will attend a site or deliver a useful report.

## 15 Assisted and advanced features

### 15.1 Receipt extraction and voice entry

OCR can propose supplier name, invoice number, date, amount, and line items from a receipt. The user reviews extracted fields before they enter the financial workflow. Keep the source image and per-field confidence. A mismatch between extracted totals and line sums requires correction. Failed extraction must not prevent manual entry.

Voice notes can produce a draft site update in supported languages. Label transcription and translation and allow editing before publication. Do not automatically convert a spoken instruction into an approval, invoice, or change order. Test language quality with local speakers before advertising Kinyarwanda transcription.

### 15.2 Summaries questions and anomaly suggestions

Generate draft weekly summaries from authorized project records, linking each material claim to its source. The owner or supervisor reviews before sharing. A project assistant may answer questions such as which invoices remain outstanding, but exact totals should come from deterministic financial queries rather than model-generated arithmetic.

Anomaly suggestions can flag repeated receipt images, unusual unit prices compared with project history, or unexplained stock variances. Display the rule, evidence, and limitations. They are review prompts, not accusations. Do not label a person fraudulent based on model output. An automated system cannot certify progress or authorize payment.

### 15.3 Future capabilities

Optional additions include approved quantity takeoff imports, professional cost-estimate templates, equipment scheduling, maintenance subscriptions, environmental material records, and integration with accounting systems. Each needs a clear data owner and validated inputs. Defer drone imagery, automated image-based progress measurement, and technical design generation until there is an evaluated use case and qualified oversight.

AI processing must respect role permissions and contractual data handling. Do not send entire project archives to a model by default. Maintain a feature-level opt-out, redact unnecessary personal information, log model and prompt versions, and define retention with the selected provider before activation.

## 16 System architecture

### 16.1 Recommended implementation

Use Expo React Native with TypeScript for mobile, React and Vite for the authenticated web application, NestJS for the API, PostgreSQL for transactions, private object storage for evidence, and a PostgreSQL-backed queue such as pg-boss initially. Use a transactional outbox and idempotent workers regardless of queue choice. Redis is optional when measured needs justify it. A Laravel backend is a viable team choice if PHP expertise is stronger; select one backend and keep the domain contracts unchanged.

Use a modular monolith initially. Modules are Identity, Organizations, Projects, Planning, Finance, Procurement, Materials, Reporting, Inspections, Documents, Communication, Marketplace, Billing, and Administration. They share a transactional database through clearly owned services. Avoid a microservice deployment until independent scaling or organizational ownership justifies the operational cost.

Pin supported dependency versions at implementation kickoff using official documentation and a lockfile. Do not treat a framework name in this specification as a mandated release version. Keep development, staging, and production separate, with isolated credentials, databases, buckets, provider accounts, and test notifications.

### 16.2 Request and event flow

Clients authenticate to the API over HTTPS. The API validates input, checks authorization, applies domain rules in a transaction, and stores an outbox event with the data change. Workers deliver notifications, build reports, scan media, and call providers. Consumers deduplicate by event ID and tolerate retry. A failed notification does not roll back an approved request.

Object uploads use server-issued short-lived upload authorization. The client uploads to a private temporary key; a worker validates and scans it; the API marks the media Ready and associates it with an authorized parent. A media ID alone does not grant access. Downloads are authorized per user and parent scope before a signed link is issued.

### 16.3 Ownership and collaboration

Project records carry organization_id and project_id. Parent-child relationships use composite checks or constraints so a child cannot reference a record in another project. Organization-scoped settings and billing records are separate. User identities can cross organizations; financial and construction data cannot.

Application authorization is mandatory. PostgreSQL row security may provide defense in depth when correctly configured; a privileged database connection can bypass protections if the deployment is careless. Workers and report generators must apply the same scope checks as normal endpoints. Tenant context should be transaction-scoped and reset for pooled connections. See the official reference list in section 25.

## 17 Data model and storage contracts

### 17.1 Shared conventions

Use UUID primary keys. Mutable records have created_at, updated_at, created_by, and integer revision. Project records include organization_id and project_id. Financial postings, approvals, signed reports, stock movements, and audit events are append-only after posting. Keep effective_at or occurred_at separate from server recorded_at. Soft deletion is for eligible drafts; it is not a substitute for retention or a way to hide posted records.

Use decimal quantities with defined precision, integer minor-unit money, ISO currency codes, and explicit units. Foreign keys protect relationships. Status values are validated enums or constrained codes, not arbitrary display text. Translation strings belong to application resources, while status codes remain stable.

### 17.2 Core tables

| Entity | Essential fields beyond shared conventions | Relationships and constraints |
|---|---|---|
| users | verified_email, verified_phone, display_name, locale, identity_provider_id | Unique provider subject; normalize verified identifiers |
| organizations | name, kind, billing_contact_id, status | One managing organization per project |
| organization_memberships | user_id, organization_id, role, status | Unique active user membership per organization |
| projects | name, owner_user_id, currency, timezone, location, status | Currency locked after first posting |
| project_memberships | user_id, role, grants, financial_visibility, expires_at | Server-side active scope check |
| invitations | recipient, scope, token_hash, expires_at, accepted_at | Single use; store token hash only |
| delegations | grantor, delegate, actions, amount_cap, valid_from, valid_to | Cannot exceed grantor permissions |
| stages | name, weight, baseline_dates, current_dates, acceptance_policy | Weights total 100 for progress calculation |
| tasks | stage_id, assignee, due_at, status, planned_quantity, unit | Scoped assignee; valid state transitions |
| dependencies | predecessor_id, successor_id, type | No cycles or cross-project edges |
| budget_versions | version_no, status, approved_at, change_order_id | One active approved version; prior versions retained |
| budget_lines | version_id, stage_id, category, unit, quantity, unit_rate, gross_amount | Versioned mapping to stable budget line identity |
| approval_policies | revision, scope, bands, steps, effective_at | Submission snapshots exact policy revision |
| approval_requests | subject_type, subject_id, subject_revision, policy_snapshot, status | Unique active request per subject revision |
| approval_votes | request_id, reviewer, step, decision, rationale | One vote per eligible reviewer and step |

### 17.3 Finance and procurement tables

| Entity | Essential fields | Relationships and constraints |
|---|---|---|
| spending_requests | purpose, required_at, gross_amount, currency, revision, status | Lines allocate to approved budget identities |
| spending_request_lines | request_id, budget_line_identity, quantity, unit, gross_amount | Sum equals request amount |
| reservations | request_id, budget_line_identity, amount, state | Converted to commitment without double counting |
| suppliers | organization or external contact, name, identifiers, status | Project-specific supplier association |
| quotations and quotation_lines | supplier, expiry, specifications, price, delivery_fee | Immutable accepted revision |
| purchase_orders and order_lines | request_id, supplier, authorized_amount, quantities, status | Allocations cannot exceed approval |
| invoices and invoice_lines | supplier, reference, date, gross_amount, status | Post only against valid authorization |
| invoice_order_allocations | invoice_line_id, order_line_id, attributable_amount | Scoped links and bounded allocation |
| credit_notes | invoice_id, amount, reason, status | Cannot over-credit an invoice without explicit model |
| direct_expenses | authorization_id, category, gross_amount, status | No duplicate invoice posting |
| payment_records | beneficiary, method, amount, provider_ref, status, verified_by | Unique provider reference per provider account |
| payment_allocations | payment_id, invoice_id, amount | Sum bounded by payment and outstanding invoice |
| refunds | original_payment_id, amount, reason, provider_ref, status | Bound to eligible original settled payment |
| retention_records | invoice_id, amount, release_condition, status | Retained liability separate from invoice cost |
| change_orders | scope, budget_delta, schedule_delta, revision, status | Unique apply operation per approved revision |
| finance_entries | source_type, source_id, line_identity, entry_kind, amount | Immutable projections support reconciliation |

Finance entries maintain deterministic budget, commitment, and cost movements; they are not a substitute for a full general ledger. If accounting integration is introduced, add a properly defined double-entry model or export mapped journals rather than calling these operational entries audited financial accounts.

### 17.4 Operations and evidence tables

| Entity | Essential fields | Relationships and constraints |
|---|---|---|
| materials and storage_locations | specification, canonical_unit, thresholds; location name | Distinct grades and units |
| deliveries and delivery_lines | order_id, supplier, receiver, accepted_qty, rejected_qty, status | Received quantity bounded by order or approved exception |
| stock_movements | material_id, quantity, type, location, stage, source_id, reversal_of | Append-only after posting |
| stock_counts | location, expected_qty, observed_qty, counted_by, status | Variance requires approved adjustment |
| site_updates | stage_id, event_date, narrative, blockers, status, revision | Published revisions preserved |
| media_assets | storage_key, checksum, MIME, size, origin, capture_time, location_accuracy, status | Private parent-scoped access |
| evidence_links | media_id, parent_type, parent_id, visibility | Allowlist valid parent types |
| documents and document_versions | category, title; file_id, revision_code, status, supersedes_id | Immutable file versions |
| inspection_bookings | scope, inspector, scheduled_at, quoted_fee, status | Competence and conflict checks |
| inspection_reports and findings | booking_id, checklist_revision, outcome, signed_at; criterion, result, severity | Submitted reports superseded by new revisions |
| defects | stage_id, finding_id, assignee, severity, due_at, status | Independent resolution where required |
| comments and decisions | parent_id, author, content; authority, rationale, effective_at | Scoped polymorphic parent validation |
| disputes | subject_id, initiator, participants, requested_resolution, status | Preserve evidence and resolution links |
| handover_packages and assets | version, acknowledged_at; serial, warranty_dates, maintenance_interval | Exact acknowledged package version |
| notification_outbox and notifications | event_id, recipient, channel, payload, delivery_status | Idempotent delivery |
| audit_events | actor, action, resource, request_id, before_after_digest, recorded_at | Append-only privileged storage controls |
| subscriptions and billing_events | payer_org, plan, provider_ref, entitlement_state, period | Separate from construction payments |
| idempotency_records and sync_operations | actor, key, body_hash, response; device, operation_id, outcome | Bounded retention and duplicate detection |

### 17.5 Indexes and validation

Index active project membership, project and status lists, tasks by assignee and due date, requests by reviewer and state, supplier invoice references, order allocations, material and location movement time, project activity time, audit resource ID, and provider transaction references. Use cursor pagination for large feeds. Enforce composite project relationships at the database level where possible, alongside service checks.

Do not store arbitrary full before-and-after files in audit logs. Record safe field changes and references to immutable versions. Restrict personal identity and sensitive incident fields to dedicated access scopes. Store device refresh tokens hashed or provider-managed, never in ordinary project tables.

## 18 Workflow states and transaction rules

| Object | Normal progression | Important branches |
|---|---|---|
| Project | Draft, Active, Handover, Archived | Paused or Cancelled; reopening audited |
| Spending request | Draft, Submitted, Under review, Approved, Converted | Changes requested, Rejected, Withdrawn, Expired |
| Purchase order | Draft, Issued, Supplier accepted, Partially fulfilled, Fulfilled, Closed | Amendment pending, Remaining cancelled |
| Invoice | Draft, Submitted, Verified, Posted | Rejected; correction through credit note |
| Payment | Initiated or Recorded, Pending verification, Settled | Failed, Cancelled, Partially refunded, Refunded, Disputed |
| Stage | Planned, In progress, Ready for review, Accepted | Blocked, Changes required, Conditional acceptance |
| Inspection | Requested, Offered, Confirmed, In progress, Report submitted, Completed | Cancelled, No show, Reinspection required |
| Defect | Open, Assigned, In correction, Ready for reinspection, Verified resolved, Closed | Correction rejected returns to In correction |
| Change order | Draft, Submitted, Under review, Approved, Applied | Rejected or Withdrawn |

Clients call named transition endpoints rather than patching status directly. Each transition has an eligible actor, preconditions, required evidence, version check, transaction, audit event, and notification event. Invalid state changes return a domain error and preserve the prior state.

Lock budget lines during reservations, allocation rows during payment allocation, order lines during invoice conversion, and material balances during stock postings. Use a consistent lock order to reduce deadlocks. Retry only operations known to be idempotent. Database constraints must prevent duplicate application even when two workers execute the same event.

## 19 API specification

### 19.1 Common contract

Use REST JSON endpoints under /v1. Authenticate all nonpublic routes with validated access tokens. Lists accept cursor, limit, sort, and allowlisted filters. A proposed default page size is 25 and maximum is 100. Return UTC ISO timestamps, currency codes, integer minor-unit amounts, decimal quantities as strings, stable status codes, and display labels separately.

Mutable responses include ETag based on revision. Updates and financial transitions require If-Match; a stale revision returns 412. Require Idempotency-Key for creations and transitions that can cause duplicate financial, stock, booking, or provider effects. Scope the key to actor, route, and project, store the body hash, and return the original outcome for identical retries. A reused key with a different body returns 409. Keep normal keys at least seven days; provider transaction uniqueness is permanent within retained records.

Error responses include code, message, field_errors, request_id, and retryable. Use 400 for malformed input, 401 for expired identity, 403 for prohibited actions in visible resources, 404 for inaccessible or absent resources, 409 for business conflicts, 412 for version conflicts, 413 for oversized files, 422 for domain validation, and 429 for rate limiting. Do not reveal hidden object names in errors.

### 19.2 Endpoint catalogue

| Area | Representative endpoints | Purpose |
|---|---|---|
| Identity | GET /me; POST /sessions/revoke; PATCH /me/preferences | Profile, sessions, language and notification settings |
| Organizations | POST /organizations; GET /organizations; POST /organizations/{id}/invitations | Workspace and organization membership |
| Projects | POST /projects; GET /projects; GET /projects/{id}; POST /projects/{id}/activate | Setup and activation |
| Membership | POST /projects/{id}/invitations; DELETE /projects/{id}/members/{user}; POST /projects/{id}/delegations | Scoped access and delegation |
| Planning | POST /projects/{id}/stages; POST /projects/{id}/tasks; POST /tasks/{id}/transitions | Work planning and controlled updates |
| Dependencies | POST /projects/{id}/dependencies; DELETE /dependencies/{id} | Schedule relationship validation |
| Budget | POST /projects/{id}/budgets; POST /budgets/{id}/submit; GET /projects/{id}/financial-summary | Versioned plan and calculated balances |
| Spending | POST /projects/{id}/spending-requests; POST /spending-requests/{id}/submit | Request approval |
| Review | GET /me/approval-inbox; POST /approval-requests/{id}/votes | Policy-controlled decisions |
| Quotations | POST /projects/{id}/quotation-requests; POST /quotation-requests/{id}/responses | Supplier offers and comparison |
| Orders | POST /spending-requests/{id}/orders; POST /orders/{id}/amendments; POST /orders/{id}/cancel-remaining | Authorized procurement |
| Invoices | POST /projects/{id}/invoices; POST /invoices/{id}/post; POST /invoices/{id}/credit-notes | Record and correct cost |
| Expenses | POST /projects/{id}/expenses; POST /expenses/{id}/post | Authorized direct expenses |
| Payments | POST /projects/{id}/payment-records; POST /payment-records/{id}/verify; POST /payment-records/{id}/allocations | External payments and allocation |
| Provider payments | POST /invoices/{id}/payment-intents; POST /provider-webhooks/{provider} | Later verified funds movement |
| Changes | POST /projects/{id}/change-orders; POST /change-orders/{id}/submit; POST /change-orders/{id}/apply | Budget and schedule amendments |
| Deliveries | POST /orders/{id}/deliveries; POST /deliveries/{id}/confirm | Accepted quantities and evidence |
| Materials | GET /projects/{id}/stock; POST /projects/{id}/stock-movements; POST /projects/{id}/stock-counts | Usage, returns, counts and corrections |
| Reporting | POST /projects/{id}/site-updates; POST /site-updates/{id}/submit; GET /projects/{id}/activity | Site communication |
| Files | POST /media/upload-intents; POST /media/{id}/complete; GET /media/{id}/download | Private media lifecycle |
| Documents | POST /projects/{id}/documents; POST /documents/{id}/versions | Versioned design and supporting files |
| Inspections | POST /projects/{id}/inspection-bookings; POST /inspection-bookings/{id}/confirm | Scheduling and assignment |
| Inspection reports | POST /inspection-bookings/{id}/reports; POST /inspection-reports/{id}/submit | Findings and immutable reports |
| Defects | POST /projects/{id}/defects; POST /defects/{id}/corrections; POST /defects/{id}/verify | Correction and independent review |
| Milestones | POST /stages/{id}/request-acceptance; POST /stages/{id}/accept | Policy-controlled acceptance |
| Communication | POST /comments; GET /projects/{id}/decisions | Contextual discussion and decisions |
| Disputes | POST /projects/{id}/disputes; POST /disputes/{id}/responses; POST /disputes/{id}/resolve | Evidence-preserving resolution |
| Exports | POST /projects/{id}/exports; GET /exports/{id}; GET /exports/{id}/download | Background reports |
| Handover | POST /projects/{id}/handover-packages; POST /handover-packages/{id}/accept | Exact-version acknowledgement |
| Sharing | POST /projects/{id}/share-links; DELETE /share-links/{id} | Scoped revocable access |
| Billing | GET /organizations/{id}/subscription; POST /organizations/{id}/checkout-sessions | Platform subscription billing |
| Sync | POST /sync/push; GET /sync/pull?cursor= | Offline operations and authorized changes |
| Administration | GET /admin/queues; POST /admin/support-access-grants | Operational oversight and audited access |

The catalogue defines the product contracts; the implementation team must publish a full OpenAPI schema with every field, response, enum, authorization rule, and example before each module is released.

### 19.3 Example spending request contract

POST /v1/projects/{projectId}/spending-requests with an Idempotency-Key. Example body:

```json
{
  "stage_id": "stage-uuid",
  "purpose": "Cement for foundation work",
  "currency": "RWF",
  "required_date": "2026-11-10",
  "lines": [{
    "budget_line_identity": "line-uuid",
    "description": "Cement bags of the agreed specification",
    "quantity": "40.000",
    "unit": "bag",
    "unit_rate_minor": 15000,
    "tax_minor": 0,
    "gross_amount_minor": 600000
  }],
  "evidence_ids": ["quotation-media-uuid"]
}
```

The server validates stage and evidence scope, recalculates totals, and creates Draft revision 1. A separate submit call validates the budget and snapshots the approval policy. An authorized vote includes decision, rationale, subject_revision, and If-Match. Final approval reserves 600,000 RWF atomically and creates an outbox event. A retry must return the same approval outcome without another reservation.

### 19.4 Webhook requirements

Validate provider signatures, reject replay outside the provider's accepted policy, persist incoming event IDs, and process duplicate or out-of-order events safely. A success redirect in the browser never marks a payment settled. Query the provider when necessary and reconcile mismatches through an exception queue. Store raw provider payloads with sensitive fields minimized and access restricted. Map provider states into domain states through a tested adapter.

## 20 Offline operation and synchronization

Offline support is required for site capture, task drafts, delivery drafts, comments, and receipt drafts. Use a local database and an operation queue with operation_id, device_id, user_id, project_id, entity_id, base_revision, payload, dependencies, and retry state. Secure local credentials separately; store as little confidential data as necessary. Provide a manual clear-cache option.

Users can take photos offline and upload later. Compress viewing copies but preserve the original according to the evidence policy. Upload dependencies first, then submit the parent record. Retry with exponential backoff and a user-visible queue. App restart must preserve drafts and queued operations. A media upload should resume or safely restart without duplicate assets.

Financial approvals, stock postings, signed inspection submission, milestone acceptance, and funds movement require online validation. Users may draft them offline, but the interface must not show them as approved, settled, or posted until the server confirms. Offline stock estimates are explicitly provisional.

For conflicting editable drafts, show the server version and local edits and ask the user to merge. Never use silent last-write-wins for money, approval, inspection, or accepted progress. Append-only comments can synchronize independently when authorization remains valid. Reject queued operations from revoked users and retain an exportable local draft where policy allows rather than falsely claiming it was submitted.

The pull cursor represents an ordered change log. Return only accessible changes, including tombstones for deleted drafts and revoked scopes. Expired cursors require a scoped refresh. A sync response records an outcome for every pushed operation: Applied, Duplicate, Conflict, Rejected, or Waiting for dependency. Validate permissions again when applying, not only when the operation was first queued.

## 21 Security privacy and operational safeguards

Use managed authentication where practical, verified contact methods, short-lived access tokens, revocable sessions, and multifactor authentication for sensitive roles. Rate-limit login, invitations, exports, uploads, and AI endpoints. Avoid placing secret tokens in URLs, logs, or notifications. Use TLS, encrypted storage, controlled backups, secret management, and least-privilege service accounts.

Protect against cross-project access, mass assignment of restricted fields, unsafe document previews, malicious uploads, webhook replay, duplicate postings, and abuse of share links. Input validation is not authorization. An unguessable UUID is not a permission check. Scope search, analytics, exports, media access, and background jobs as carefully as ordinary screens.

Create a documented data inventory, consent and privacy notices, retention schedule, processor review, account deletion workflow, and incident response procedure before launch. Complete the Rwanda-specific data classification, registration and hosting review before selecting production providers or processing real pilot personal data. Keep early development on synthetic data. Review professional services and regulated payments before activating those capabilities. This document does not assert a particular legal retention period or that a provider arrangement is compliant.

Distinguish account deletion from removal of records that other project participants legitimately need. Anonymize eligible attribution where appropriate, preserve required records under an approved retention policy, and explain the result to the requester. Shared links and support access are revocable. Avoid public exposure of exact site locations or personal contact details.

Audit logs should be append-only to application users, protected from routine administrator alteration, and backed up separately. A checksum alone does not make them tamper-proof against a privileged operator. Record login-sensitive changes, invitations, role changes, approvals, postings, corrections, exports, sharing, support access, and ownership transfers. Keep unnecessary personal data out of audit payloads.

## 22 Performance reliability and operations

### 22.1 Proposed service targets

| Target | Acceptance condition |
|---|---|
| API responsiveness | p95 under 800 ms for ordinary reads and 1.5 seconds for ordinary writes, excluding file transfer and provider latency, at documented pilot load |
| Initial mobile experience | Useful cached screen within 2 seconds on reference Android device; remote content loads progressively |
| Upload limits | Initial maximum 15 MB per photo, 100 MB per video, 25 MB per document; adjustable with clear errors |
| Availability | Initial production objective 99.5 percent monthly, with planned maintenance communicated |
| Recovery | Initial recovery point objective 24 hours and recovery time objective 8 hours; revise after restore drills |
| Scale test | At least 100 concurrently active sessions and 1,000 projects in a representative staging dataset |
| Accessibility | Critical journeys pass keyboard, screen reader, contrast, and large-text checks |

These are engineering targets, not achieved guarantees. Define reference devices, network profiles, dataset size, and test duration when measuring them. Load media lazily, generate thumbnails, paginate feeds, and avoid blocking the home screen on all project modules.

### 22.2 Monitoring and support

Monitor API errors and latency, outbox backlog, failed uploads, notification failures, stuck approvals, provider mismatches, database capacity, and backup completion. Use correlation IDs across client, API, and jobs. Alert on failed financial processing and repeated authorization failures. Log structured errors without tokens, full identity documents, or raw confidential attachments.

Maintain runbooks for provider outage, duplicate event, lost upload, database restore, compromised account, incorrect role assignment, and failed report generation. Restore database and media together to a consistent recoverable point. Test restores in a separate environment at least quarterly during operation. Use lifecycle rules carefully so archived evidence is not deleted ahead of policy.

### 22.3 Deployment and delivery

CI must run type checking, linting, meaningful unit and integration tests, migration checks, dependency scanning, and build verification. Use reviewed migrations with a rollback or forward-repair plan and backups before risky data changes. Deploy staging first and test core journeys. Feature flags isolate unfinished modules and allow operational rollback without corrupting committed records.

Separate app versions from server schema migrations. Keep APIs compatible with supported installed app versions, and provide upgrade messaging for obsolete versions. Use a controlled rollout for mobile builds. Maintain an operational owner for production incidents and partner-service failures before accepting paying users.

## 23 Business model and subscription experience

### 23.1 Proposed packages

| Package | Intended payer | Included value |
|---|---|---|
| Single project | Individual owner | One active project, standard team, reporting, approvals, evidence and exports |
| Contractor company | Contractor business | Multiple projects, client invitations, portfolio and company reporting |
| Developer company | Property developer business | Larger portfolio, approval policies, finance roles and reporting controls |
| Optional services | Owner or company | Inspection bookings, setup assistance and agreed partner services |

Determine prices through customer interviews, pilot conversion, service cost, and storage usage. A sample 15,000 RWF monthly project subscription is a pricing experiment only. At 100 paying projects it yields 1,500,000 RWF gross monthly subscription revenue before fees, taxes, support, storage, and partner costs. Do not treat this arithmetic as a demand forecast.

### 23.2 Entitlements and cancellation

Track subscription billing separately from construction finances. Entitlements are derived from verified billing events, with a configurable grace period. When a plan expires, preserve read access and export access for the promised period, while restricting new project creation or new submissions according to disclosed terms. Never prevent a customer from reviewing a disputed invoice solely because of a subscription problem.

The payer may differ from the project owner. Make payer, renewal date, price, taxes, limits, cancellation effect, and service fees visible before checkout. Downgrading a company with excess active projects requires choosing which remain editable. Archived projects do not disappear. Inspection charges and refunds are separately itemized.

### 23.3 Growth approach

Start with reachable contractors who already manage active projects, and ask them to invite their owners after seeing a useful quotation and report. Partner with a small group of independent inspectors. Offer a real sample weekly report and a short onboarding session. Measure conversion and ongoing usage before expanding geographically. Permission-controlled sharing and contractor invitations can support growth, but do not incentivize exposing customer documents publicly.

## 24 Delivery backlog acceptance and testing

### 24.1 Implementation sequence

Build Identity and project scope first, then Planning, Budget and Approvals, Evidence and Updates, Procurement and Financial posting, Materials, Inspections, Handover, Billing, and Partner integrations. Each module should include permissions, audit events, API schema, empty states, error states, and integration tests in its completion criteria. Do not leave these as a final hardening phase.

Suggested work packages are discovery and design; infrastructure and identity; project and planning; money and procurement; media and offline reporting; materials; inspection and defect workflows; reports and handover; subscriptions and operations; pilot correction; and later marketplace and AI. Estimates should follow team capacity and validated scope rather than an invented completion date.

### 24.2 Representative user stories

| ID | Story | Acceptance criteria |
|---|---|---|
| SP01 | Owner creates a project and invites a supervisor | Recipient verifies invited contact; only this project becomes visible; expired invite fails |
| SP02 | Supervisor submits an update without connectivity | Draft survives restart; media later uploads; update shows submitted only after confirmation |
| SP03 | Owner approves cement spending | Exact revision and policy are shown; own-submission conflict enforced; budget reservation appears once |
| SP04 | Finance posts a partial invoice | Cost increases and remaining commitment decreases by the attributed amount; total budget usage is not doubled |
| SP05 | Receiver accepts a partial delivery | Accepted quantity increases stock once; rejected quantity does not; remaining order stays open |
| SP06 | Contractor requests a design change | Budget and dates remain unchanged until approval and atomic application; second apply is a no-op |
| SP07 | Inspector rejects work | Finding creates assigned defect; required acceptance is blocked; correction requires configured reinspection |
| SP08 | Owner replaces a contractor | Previous records remain; old access is revoked; tasks reassigned; new contractor lacks inherited approvals |
| SP09 | Finance records an advance | Cash paid increases after verification; cost does not; later allocations respect balances |
| SP10 | Owner accepts handover | Exact package version is acknowledged; open items remain visible; warranties and downloads are accessible |
| SP11 | User opens another project's attachment ID | API and media issuance return no content or identifying detail |
| SP12 | Subscription lapses | New writes follow disclosed limits; promised read and export access remain |

### 24.3 Essential automated tests

Financial tests cover the worked example, two simultaneous approvals against limited headroom, request-to-order conversion, partial invoices, credits, advances, retention, refunds, duplicate receipts, and over-allocation. Confirm totals are stable after retries and corrections. Test currency precision and quantity rounding with more than one currency and unit.

Authorization tests attempt cross-project access across every entity family, file download, search, export, share link, worker job, and sync operation. Test suppliers seeing only their orders, inspectors seeing only assigned scopes, revoked delegates, expired memberships, and restricted financial fields.

Workflow tests cover invalid state transitions, edited requests invalidating votes, rejected inspections, missing evidence, dependency cycles, cancelled bookings, contractor replacement, and project archive behavior. Stock tests cover partial acceptance, quarantine, returns, stage waste without double subtraction, transfer balance, negative stock rejection, and count adjustments.

Offline tests cover network loss, restart, duplicate queue replay, missing upload dependency, version conflict, and revocation before synchronization. Provider tests cover invalid signatures, duplicate callbacks, success before pending callback, failed transfer, delayed confirmation, and reconciliation after outage. Never test payments by merely checking a client success page.

### 24.4 Usability and launch checks

Ask an owner to review a request, a supervisor to submit a site update, a receiver to confirm a partial delivery, and an inspector to submit a failed finding without coaching. Record completion, errors, time, and confusing labels. Test English and Kinyarwanda on a modest Android device and a limited network. Review notification privacy and large-text layouts.

Launch requires a tested restore, documented partner responsibilities, support process, billing reconciliation, scoped exports, acceptable security findings, and a verified end-to-end pilot. AI and marketplace features can remain disabled without preventing the core product from serving customers.

## 25 Technical references and decision register

### 25.1 Official technical references

The following references support specific implementation mechanisms, not the product's commercial assumptions. Accessed 8 October 2026.

1. PostgreSQL Row Security Policies. https://www.postgresql.org/docs/current/ddl-rowsecurity.html. Reference for database-level row restrictions; application permissions remain mandatory.
2. MDN If Match request header. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match. Reference for conditional writes and ETag version checks.
3. Expo Local first architecture. https://docs.expo.dev/guides/local-first/. Reference for local storage and synchronization architecture; JengaLink's conflict rules are defined in section 20.
4. OWASP API Security Project. https://owasp.org/projects/api-security-project. Reference for object and property authorization risks and API threat review.

5. Rwanda Data Protection and Privacy Office registration provisions. https://dpo.gov.rw/dpp-law/registration-of-a-data-controller-and-a-data-processor. Relevant to controller and processor registration before real-data processing.
6. Rwanda Data Protection and Privacy Office sharing transfer storage and retention provisions. https://dpo.gov.rw/dpp-law/sharing-transferstorage-and-retention-of-personal-data. Distinguishes cross-border transfers from external storage authorization.
7. Rwanda Revenue Authority About EBM. https://www.rra.gov.rw/en/about-ebm. Reference for EBM records and the separate certification process for invoice-system integration.
8. RISA KUBAKA launch. https://www.risa.gov.rw/news-detail/kubaka-risa-powers-the-future-of-smart-building-services. Identifies KUBAKA as the replacement for the former BPMIS.
9. Paypack payment flow. https://docs.paypack.rw/overview/payment-flow/. Documents mobile-money transaction states; card acquiring and recurring billing need separate confirmation.
10. Pindo SMS overview. https://docs.pindo.ai/docs/messaging/overview. Documents messaging and verification endpoints; integration still needs routing and price testing.
11. Expo runtime versions and updates. https://docs.expo.dev/eas-update/runtime-versions/. Native-code changes require a compatible new build.
12. pg-boss official project. https://github.com/timgit/pg-boss. Documents transactional job creation with supported adapters.
13. SiteProof construction compliance product. https://www.site-proof.app/. Evidence of existing use of the provisional name.
14. SiteProof construction management product. https://siteproof.work/construction-project-management-software. Additional existing use of the provisional name.
15. Construct KVV. https://www.constructkvv.rw/. Publicly advertises professional discovery, materials and project tracking in Rwanda; independent operational evaluation remains necessary.

### 25.2 Decisions to resolve before production

| Decision | Proposed default | Responsible review |
|---|---|---|
| Product name and brand | JengaLink (decided) | Founder completes domain, app-store, company-name and trademark registration |
| First operating area | Kigali and a limited nearby service area | Product and partner operations |
| Backend framework | TypeScript modular monolith | Technical lead based on team capability |
| Identity provider | Managed identity with verified contact and MFA support | Technical and security leads |
| Initial languages | English and Kinyarwanda | Product and local language reviewers |
| Payment providers | Approved provider adapters; no platform custody | Finance, legal and technical leads |
| Inspection partners | Qualified professionals with disclosed scope | Operations and qualified reviewer |
| Data retention and residency | Review before provider commitment and before real-data pilot | Legal, security and operations |
| Subscription price | Pilot experiment rather than fixed assumption | Founder and finance |
| Approval bands | Owner approval for all spending initially | Project owner and product |
| AI services | Disabled until evaluated and reviewed | Product, security and qualified domain reviewers |

The development team can implement the core specification using the proposed defaults. Provider contracts, legal obligations, professional inspection criteria, and commercial pricing must be resolved before the corresponding production capability is activated.

## 26 Rwanda readiness and practical integrations

### 26.1 EBM receipt records

RRA describes EBM invoicing obligations for taxable activities and a certification process for integrating an invoicing system. JengaLink initially collects supplier-issued evidence; it does not issue an official EBM invoice or claim to be an RRA-certified invoicing system. If the platform itself needs invoice issuance, treat that as a separate integration and certification workstream. Reference 7 supports this distinction.

Record supplier name, supplier TIN where present, buyer identifier where relevant, invoice number, date, total, tax fields, available EBM identifiers or QR payload, original file and reviewer. Keep Not supplied, Captured, Manually reviewed, Externally confirmed and Discrepancy found as distinct states. Externally confirmed requires a supported channel, result reference and time; parsing a QR code or recognizing a number does not qualify.

No public third-party receipt-validation API is assumed in the build plan. Confirm access and permitted use with RRA before implementing automatic verification. Initially use document capture, duplicate detection, supplier follow-up and recorded manual checks. Permit a documented exception when EBM evidence is missing; finance decides eligibility under the project's rules and professional advice. An EBM record cannot prove that material arrived or was used correctly.

### 26.2 Mobile money and payment provider selection

Name MTN MoMo and Airtel Money as target payment methods in the Rwanda interface. Evaluate a contracted aggregator or direct provider integration rather than implementing every candidate. Paypack documentation describes cashin and cashout transactions and pending, successful and failed states; it does not establish that every proposed diaspora card or recurring billing requirement is supported. Reference 9 supports this narrower description.

For each candidate record supported countries, collection methods, merchant eligibility, card acceptance, settlement currency, refund support, subscriptions or payment links, webhook authentication, sandbox availability, fees, settlement delay, reporting and data location. Test Rwanda collections and target diaspora countries before selecting the provider. Do not assert that a named provider supports all channels merely because it supports mobile money. Keep subscription revenue collection separate from client construction funds.

A0 records customer-controlled external transfers. A later provider flow should pay the intended beneficiary through a reviewed partner arrangement. Cashout to a beneficiary from a platform account can change the custody and regulatory model; do not enable it under an unsupported claim that the platform never holds funds.

### 26.3 Registration hosting and data transfers

The DPO publishes a registration requirement for intended controllers and processors under Article 29. Article 50 addresses storage in Rwanda and permits outside storage under a registration certificate authorizing it. Article 48 describes several grounds for cross-border transfer, while Article 49 addresses transfer contracts. These are different questions; consent should not be treated as automatically resolving outside storage. See references 5 and 6 and obtain advice on the actual arrangement.

Before real-data pilot onboarding, document who controls and processes each category, initiate the required registration, and confirm the permitted architecture. Map the API, databases, files, backups, authentication, SMS, push, WhatsApp, analytics, support, and AI providers. A local database alone does not eliminate external processing. Select hosting and processors only after this review; prototype with synthetic data while it is pending. Record approvals, contracts and authorized countries in the deployment decision register.

### 26.4 Permits and KUBAKA

RISA announced KUBAKA as replacing the old BPMIS in April 2025. Store portal type, permit or application reference, site or plot reference where needed, entered status, entered dates, supporting file, who checked it and when. Offer an allowlisted link to the official portal. An uploaded permit and a link are not a verified approval. Do not scrape private accounts or promise automated status synchronization without an authorized API or agreement. Reference 8 supports the portal naming.

### 26.5 Phone-first access and WhatsApp sharing

Make verified phone OTP the default site-worker sign-in, with email sign-in and stronger authentication available to owners and finance. Store E.164 numbers. An OTP proves control of a number at a point in time, not legal identity or employment. Require a fresh verified session and additional review for number changes, financial-role recovery and suspicious account activity. Do not auto-merge accounts by display name.

Use capped OTP retries, resend delay, short expiry, device and number throttles, delivery monitoring and redacted logs. Pindo documents verification endpoints; evaluate local delivery and pricing rather than assuming it is cheaper or compatible with every managed identity provider. A custom SMS hook must be supported and tested by the chosen identity system. Where it is not, use the managed provider's supported delivery flow or a coherent alternative; do not bolt on a second identity store.

A0 allows the user to share a limited weekly summary or report link through their phone's share menu, including WhatsApp. Show a privacy preview and expiry before sharing. Forwarded links still enforce scope and recipient restrictions. Release C can automate opt-in WhatsApp Business messages after current channel rules, templates, pricing and processor arrangements are confirmed. WhatsApp replies never approve spending automatically; a reminder links to an authenticated approval screen.

## 27 Workforce attendance and daily wages

### 27.1 Worker and rate records

Support workers who do not have app accounts. Store a project worker ID, display name or agreed alias, trade, responsible contractor, contact only if needed, start and end dates, agreed rate, rate unit and supporting agreement. Restrict wage details to authorized managers and finance; other workers cannot see peers' payments. Employee classification, tax and social contribution obligations require professional review; this module records agreed work and payments without claiming to be compliant payroll software.

Rates are effective-dated and immutable after a wage batch is approved. An attendance entry records worker, work date, stage, full day or approved fractional day, overtime units where agreed, supervisor, and evidence or notes. Deduplicate worker plus work date plus authorized shift. Offline attendance is a draft until validation. Attendance may be confirmed separately from payment approval.

### 27.2 Wage calculation and payment

Create a wage batch for a period. Lines reference attendance and the effective rate, gross earned amount, explicitly agreed adjustments, amount payable and allocations. Adjustments need a type, reason and authorization; the app must not silently deduct money. Finance or the owner approves the exact batch revision. Approval posts labor expense and releases or converts its budget reservation once, while payment settles a liability separately.

Wages may be paid directly from an owner-controlled account or out of an approved site float. Cash acknowledgement and a mobile-money reference are supporting evidence, not conclusive proof that a worker received the correct amount. Record recipient acknowledgement, payer evidence, verifier and disputed status separately. Worker confirmation can be manual during the pilot, with a witness or documented exception. Do not require a smartphone from every worker.

Example: ten workers with two accepted days each at 8,000 RWF produce 160,000 RWF gross labor cost. Posting the batch recognizes 160,000 RWF cost once. Paying 100,000 RWF leaves 60,000 RWF outstanding. The payment does not post another 100,000 RWF expense. A worker advance is linked to later allocations and cannot be both paid anew and deducted twice. Correct an approved batch with a reversal or adjustment batch linked to the original.

### 27.3 Data and API additions

Add workers, worker_rate_versions, attendance_entries, wage_batches, wage_lines and wage_payment_allocations. APIs include POST /projects/{id}/workers, POST /projects/{id}/attendance, POST /projects/{id}/wage-batches, POST /wage-batches/{id}/submit, POST /wage-batches/{id}/post and POST /wage-batches/{id}/payment-allocations. Attendance state is Draft, Submitted, Confirmed or Rejected. Wage state is Draft, Submitted, Approved, Posted, Partially paid or Paid; disputed payment is a separate condition.

## 28 Site float petty cash and accountable custodians

### 28.1 Purpose and custody

A site float is money controlled by the customer and entrusted externally to a named custodian such as a foreman or relative. JengaLink records custody and reconciliation; it does not receive or hold that money. Identify the custodian, currency, authorized purpose, limit, funding evidence and reconciliation frequency. The owner can freeze further spending requests without deleting the prior custody record.

Float funding changes recorded cash custody, not construction cost. Each disbursement references an approved expense, wage obligation or advance; each recognized cost posts only once through its underlying source. An expense incurred but not yet paid increases cost and a payable; it does not reduce cash on hand. A cash disbursement reduces custody balance when verified. Returns to the owner reduce custody balance and remain distinct from supplier refunds or cost credits.

### 28.2 Reconciliation

Expected float balance equals opening balance plus confirmed top-ups and returned cash receipts, less verified disbursements and confirmed returns to the owner. Show pending movements separately. Reconciliation compares expected balance with the custodian's observed cash or wallet balance as of a cutoff. Differences create an exception; they do not automatically become expenses or accusations.

Example: the owner confirms a 500,000 RWF top-up. The custodian pays 120,000 RWF for materials and 80,000 RWF against a posted wage batch. Expected custody is 300,000 RWF. If observed custody is 290,000 RWF, the 10,000 RWF variance remains unexplained until reviewed. Do not post it as miscellaneous expense by default. Supplier payment advances reduce float cash but remain unallocated advances rather than cost until a legitimate cost record exists.

The custodian submits a statement with movements, receipts and observed balance. An independent authorized owner or finance reviewer accepts it, asks for changes or records a resolution. A person cannot approve their own unexplained variance. Reconciliation closure locks the statement cutoff; later corrections appear in a linked adjustment period. A top-up recommendation must consider both remaining cash and approved unpaid obligations to avoid duplicate funding.

### 28.3 Data and API additions

Add float_accounts, custody_transfers, float_disbursements, float_reconciliations and reconciliation_findings. Disbursements link to payment records instead of creating a second payment. Use POST /projects/{id}/float-accounts, POST /float-accounts/{id}/top-ups, POST /float-accounts/{id}/disbursements, POST /float-accounts/{id}/reconciliations and POST /float-reconciliations/{id}/review. Restrict custody information to owner, named custodian and granted finance roles. Prevent negative confirmed balance unless an explicitly supported overdraft arrangement exists; provisional offline entries do not bypass validation.

## 29 Diaspora funding and foreign currency records

Record external owner funding from the pilot onward even though the project remains in RWF. Store sender, beneficiary or custodian, sending currency, gross sent amount, source fee, net converted source amount if known, exchange-rate direction, rate, conversion date, destination currency, net received amount, reference, evidence and verification status. Record fees in the currency actually charged. Unknown values remain unknown rather than zero.

Net received RWF is the amount credited to the project funding or custody record after verification. This is not revenue and is not an expense. Where all inputs are known, show implied received rate and explain whether fees are included. Do not infer an accurate market exchange rate from a transfer that includes fees. Keep the source transfer amount and receipt amount even if reconciliation differs.

Example: the owner sends 1,000 USD. A 10 USD source fee leaves 990 USD converted at 1,400 RWF per USD, producing 1,386,000 RWF before destination fees. A 6,000 RWF destination fee leaves 1,380,000 RWF received. The float receives 1,380,000 RWF; the project does not gain 1,400,000 RWF budget automatically. Funding availability and approved spending budget remain separate. This is illustrative arithmetic, not a current exchange-rate quotation.

Add funding_transfers and funding_receipts with unique references, currency fields and links to custody transfers. POST /projects/{id}/funding-transfers and POST /funding-transfers/{id}/confirm-receipt must be idempotent. A recorded transfer is pending until receipt is verified; duplicate import must not add funds twice. Checkout presentation may show the payer's currency only when the chosen provider supports the corresponding charge and settlement. Never silently convert construction records into checkout currency.

## 30 Equipment hire and returns

Create a hire agreement with supplier, equipment identifier, specification, stage, start and planned end, billing unit, rate, minimum period, deposit, transport fees, operator terms, idle-day rules, damage assessment and signed conditions. Record actual dispatch, arrival, use, authorized idle days, extension approval and return. Do not charge every calendar day automatically if the agreement defines working days or excludes idle periods.

Hire cost recognizes approved service periods through an invoice or direct expense; equipment booking itself is only a commitment. A refundable deposit is a cash movement and recoverable amount, not hire expense. Deductions from a deposit require an approved charge record; returning the deposit is not a reversal of valid hire cost. Extensions reserve additional budget before continuing under agreed policy.

Add hire_agreements, hire_periods, equipment_logs, return_reports and deposit_allocations. APIs include POST /projects/{id}/hire-agreements, POST /hire-agreements/{id}/logs, POST /hire-agreements/{id}/extensions and POST /hire-agreements/{id}/return-reports. Show upcoming return dates, unresolved damage claims and overdue deposits separately. A return photo is evidence of condition, not automatic agreement by both parties.

## 31 Owner contractor agreement and policy source

Store an agreement version before configuring retention, advances, milestone payments or hire terms. Fields include parties and roles, scope, referenced drawings, contract amount and currency, payment schedule, advance treatment, retention, acceptance requirements, inspection responsibility, change approval, reporting frequency, defects period, termination process and attached signed document. Use structured summaries linked to the exact attachment; do not present a generated summary as the signed contract.

Where an agreement term drives an automated rule, record the clause reference and owner-confirmed setting. Conflicting rules block activation until clarified. Material agreement changes create a new version accepted by the relevant parties under the selected confirmation process. Clicking Acknowledge records receipt; it is not automatically described as a legally enforceable signature. Signature-provider selection and legal effect require their own review.

A0 supports an uploaded agreement and simple owner-confirmed settings. Later releases may add signing integrations. Agreements establish the basis for the operational policy; the app cannot resolve an unclear contract by inventing a rule. Add project_agreements and agreement_acknowledgements with version, parties, dates, file_id and policy links.

## 32 Pilot priorities team and implementation plan

### 32.1 Build order within the pilot

| Priority | Deliverable | Completion rule |
|---|---|---|
| P0 | Contractor quotation and milestone payment claim | Exact quote revision and commercial basis are accepted by owner; claims show evidence and requested, approved, due and disputed status |
| P0 | Identity, project scope and invitations | Phone or email verification; revoked and foreign-project requests denied |
| P0 | Stages, budget and simple approved revisions | Owner approves baseline; no silent edits; no spending beyond permitted capacity |
| P0 | Updates, photos and offline drafts | Draft survives restart; upload is private; server confirms submission |
| P0 | Requests, expenses and external payment evidence | Reservation converts to expense; payment is separate; every retry deduplicates |
| P0 | Custody and petty cash | Top-ups, disbursements, observed balance and independent reconciliation |
| P0 | Basic attendance and wages | Agreed rate and period; approved labor cost and partial payment remain separate |
| P0 | External funding and weekly report | Net received value is reconciled; report links to source records |
| P1 | EBM metadata, agreement and permit reference | Useful capture and review without unsupported verification badges |
| P1 | Reminder preferences and share preview | Minimum disclosure; scoped links; no approval through chat |
| Later | Formal orders, marketplace and AI | Kept out of pilot navigation until functional and validated |

P0 defines the target A0 pilot. If capacity is insufficient, reduce the number of pilot projects or agree a documented feature slice rather than implementing unfinished finance controls. P1 is the first enhancement batch, with timing based on pilot evidence. Maintain the full roadmap, but avoid physical unused tables and complex procurement screens solely to anticipate future demand.

### 32.2 Proposed team and schedule assumptions

A planning team is one product owner who coordinates pilot customers, one engineer leading API and data rules, one engineer leading mobile and web, a part-time designer, and part-time testing and qualified construction review. Roles can overlap, but financial and access-control review needs an independent reviewer. Partner onboarding runs alongside software delivery.

Treat a twelve-week initial development window as a planning scenario, not a promised delivery date. Weeks 1 and 2 validate reporting, custody, data-processing arrangements and wireframes. Weeks 3 through 5 establish identity, project scope, stages, budget and media. Weeks 6 through 9 implement approvals, expenses, float, basic wages and offline capture. Weeks 10 through 12 focus on reports, usability, security checks and pilot deployment. Reestimate after week 2 using actual capacity and unknown integrations. A six-to-eight-week live pilot follows development readiness rather than sharing the same assumed period.

### 32.3 Budget worksheet

Budget equals sum of role effort multiplied by agreed rates, plus provider setup, recurring hosting and storage, OTP and notifications, partner inspections, testing devices, local travel, support and contingency. Record effort in person-days and a common budget currency. Keep one-time development and ongoing service costs separate. A proposed contingency range is 15 to 25 percent of estimated costs; choose the percentage based on uncertainty. No supplier quote or total development price is implied by this document.

Obtain quotes for hosting in the approved arrangement, real SMS delivery, storage growth and payment processing before committing a customer price. Use pilot media volumes and active-user behavior to estimate recurring costs. Inspector coordination costs can exceed software hosting costs and must be priced separately.

### 32.4 Pilot acceptance scenarios

Owner approves a 100,000 RWF request and an authorized 80,000 RWF expense consumes that amount, leaving 20,000 RWF reserved until explicitly released or used. Finance verifies a 50,000 RWF payment, leaving 30,000 RWF expense payable. No purchase order is required for this A0 journey. Independently test the float and wage examples, the foreign-funding calculation and permission denial. A1 later runs the formal order and invoice example from section 6.7.

At pilot review, examine report regularity, missing evidence, unresolved custody variance, time spent on reporting, decision delays, willingness to pay and contractor experience. A proposed readiness target is at least 80 percent of due weekly reports submitted and owner-reviewed during the pilot; it is a target to evaluate, not a promised outcome. Any unreconciled financial defect that compromises balances blocks broader rollout.

## 33 Product analytics and measurable outcomes

Define product events in a versioned catalogue: project_created, owner_invite_accepted, budget_approved, reporter_invite_accepted, update_submitted, request_submitted, request_decided, expense_posted, payment_verified, float_reconciliation_submitted, float_reconciliation_reviewed, report_generated, report_viewed and subscription_verified. Each includes event ID, pseudonymous actor, project ID, role, release, timestamp and result. Exclude names, exact addresses, phone numbers, document content and wage lines from analytics payloads.

Emit state-change events from the committed server transaction or outbox; client button clicks are interaction events, not proof of completion. Deduplicate events and do not let a retry increase activation or payment counts. Disable session replay on financial, identity, documents and worker screens; any later replay requires a reviewed masking and consent design. A self-hosted or regional analytics setup must still follow the processor and hosting decision.

| Metric | Calculation | Review frequency |
|---|---|---|
| Activation rate | Projects with owner acceptance, approved budget, reporter and first submitted update divided by eligible created projects | Weekly |
| Reporting coverage | Due weekly reports submitted by deadline divided by reports due for active reporting projects | Weekly |
| Owner review rate | Generated weekly reports acknowledged or reviewed within the agreed window divided by delivered reports | Weekly |
| Approval turnaround | Median and p90 elapsed time from valid submission to final decision; expired and withdrawn reported separately | Weekly |
| Custody reconciliation | Due float statements independently reviewed divided by statements due; show outstanding variance count separately | Weekly |
| Paid conversion | Eligible trial payers with verified first subscription settlement divided by eligible trial payers | Monthly |
| Contractor retention | Contractor organizations creating a subsequent eligible project within the chosen cohort window | Monthly |

Use cohort dates and eligibility definitions so cancelled or paused projects are not silently dropped from denominators. Do not count a shared-link click as a verified owner review unless the identity is established. Support cost includes actual staff effort and partner coordination. Combine analytics with interviews so a high open rate is not mistaken for useful information.

## 34 Seed data demo fixtures and quality checks

Create a deterministic synthetic demo with one owner household, one contractor organization, two supervisors, one finance user, one supplier and one inspector. Include two projects with completely different access scopes, a staged Kigali house and a renovation, sample agreement and permit references clearly marked Demo, four budget categories, photos generated or licensed for demonstration, and no real identity or phone number. Use provider sandbox identifiers, never realistic payable account details.

Fixtures include an approved request, an edited request with invalidated votes, an expense with missing EBM details, a float top-up and variance, a partly paid wage batch, a foreign-currency transfer with fees, a partial delivery, a refundable equipment deposit, a failed inspection and a superseded drawing. Reset scripts recreate the demo without touching production. A Demo environment banner must remain visible.

Unit and integration tests extend section 24 with A0 request-reservation conversion, wage-rate effective dates, duplicate attendance, float cash versus unpaid expense, supplier advance without cost, foreign-fee reconciliation, refundable deposit versus hire expense and scoped invoice submission. Concurrency tests attempt two disbursements against one float balance. Security tests cover worker wage privacy and OTP recovery. A migration test upgrades the pilot expense model to formal procurement without reposting historical cost.

## 35 Competition naming and operational trust

Construct KVV publicly advertises project tracking, professionals and materials in Rwanda. The SiteProof websites in references 13 and 14 advertise overlapping construction workflows internationally and explain why the earlier working name was dropped. These public pages do not establish market share, customer satisfaction, or actual feature quality. Do not describe the product category as absent from Rwanda.

Before market positioning, interview customers using spreadsheets, WhatsApp, local contractors and available platforms. Evaluate onboarding, diaspora visibility, site float, wage reporting, independent inspection, affordability and connectivity. The opportunity hypothesis is a focused owner experience with practical custody reporting and a dependable local service network. Validate that combination rather than copying every enterprise construction feature.

Recruit qualified inspectors early, define service areas and conflicts, and set operational turnaround promises only after confirming capacity. Give contractors a clear benefit: recorded decisions, less repeated reporting and professional client communication. An app that burdens the reporter will not produce trustworthy data. Owner confidence depends on independent checks, consistent reporting and good resolution of exceptions, alongside the software.

## 36 Design system and implementation wireframes

### 36.1 Design tokens

Use a consistent eight-point spacing system, 16-pixel base body text, 20-pixel section titles and 28-pixel dashboard titles, with system fonts for initial builds. Suggested product colors are deep navy #16324F for navigation, teal #087F8C for primary actions, pale gray #F5F7FA for surfaces, dark text #172B4D, and a neutral border #DCE3EB. Validate contrast for each text and background combination. Status icons and labels accompany all colors.

Cards have one main action, limited secondary content and clear freshness labels. Money summaries show Project cost, Unused commitments, Cash paid and Float balance separately. The action inbox shows category, amount if permitted, requester, age and review action. Forms use fixed labels, clear units, field-level errors and a saved-draft indicator. Components include project selector, status badge, evidence strip, amount input, quantity and unit pair, approval footer, timeline item, sync indicator and report preview.

### 36.2 Pilot navigation simplification

A0 mobile uses Home, Updates, Money and More. Projects switch through the header; the action inbox is a Home section. Home prioritizes a current summary and pending decisions. Updates contains the photo timeline and Add update. Money contains requests, expenses, payment records, funding, wages and float according to permissions. More contains team, documents, reports, agreement, settings and support. This is a simplified pilot shell of the complete navigation in section 4; the five-destination layout is introduced only when project and activity volume justify it.

The site supervisor's primary action is Add site update. The owner's primary action is Review decisions. The custodian's primary actions are Record payment and Reconcile float. Finance sees outstanding exceptions. Hide inaccessible modules, but explain denied access for a previously visible link. Avoid empty marketplace and AI tabs during the pilot.

### 36.3 Low fidelity screens

The following wireframes show hierarchy and navigation, not final branding. Amounts and project details are synthetic. Retain separate reporting, financial and verification states when producing final Figma or code components.

The Word edition embeds a mobile wireframe with owner decisions, progress, a payment claim and documents, alongside a supervisor view for attendance, updates, expenses and synchronization.

The owner sees pending decisions above the activity summary. The supervisor sees a short capture form, optional evidence and the offline draft state. Both use the same four-tab pilot shell.

The Word edition embeds a finance wireframe with three separate cards for expected cash, observed cash and unresolved variance, followed by the custodian statement and review controls.

The finance workspace distinguishes expected custody, observed custody and unexplained variance. Reviewing a statement does not automatically turn variance into expense. Detailed tables remain on web, with concise mobile equivalents.

## 37 Contractor-led adoption and commercial incentives

Contractors are the initial acquisition channel because they can introduce the system across several owner projects. Position the product as a work-and-payment workspace: demonstrate a quotation, a funding request and an owner-ready report before asking the contractor to invite an owner. Do not assume every contractor misuses money. The platform should support legitimate profit while making the agreed financial arrangement clear.

### 37.1 Three commercial arrangements

Each agreement states whether the work is fixed price, reimbursable actual cost plus an agreed fee, or a hybrid with an explicit basis for each work package. A fixed-price stage can be quoted at RWF 5,000,000 even if the contractor estimates its own delivery cost at RWF 4,000,000. The difference is an estimated gross margin, not a project expense to fabricate. The contractor bears the risks stated in the contract. The owner sees the agreed selling price, scope, milestones, approved variations and amounts payable. Internal supplier costs and margin are contractor-company records unless the agreement requires disclosure.

For reimbursable work, the owner sees the actual eligible cost and the agreed fee or markup separately. An expense cannot include undisclosed inflated costs. For a hybrid contract, the application labels every package with its charging basis; changing that basis requires agreement by the appropriate parties. These are proposed product arrangements, not legal contract templates.

The initial pilot prioritizes contractor-managed fixed-price milestones plus explicit reimbursable items. Full company estimating, overhead allocation and profit reporting follow in A1. Existing financial screens must identify whose budget they represent. Do not combine the owner's contract value with the contractor's internal production costs in a single total.

### 37.2 Features that give contractors a reason to invite owners

| Feature | Contractor benefit | Owner benefit |
|---|---|---|
| Quotes with scope, exclusions and expiry | Produces a professional proposal and protects agreed scope | Understands the work and price before accepting |
| Funding requests and due dates | Shows upcoming labor and material needs early | Can plan payments and see the reason for each request |
| Milestone evidence and acceptance | Supports payment claims with an agreed checklist | Can review progress before accepting work |
| Change requests with cost and time effects | Documents extra work before it consumes labor | Can approve, reject or defer a change with clear consequences |
| One-tap weekly report | Reduces repeated calls and manual report writing | Receives a consistent account of progress and decisions |
| Owner decision queue | Records requests for drawings, selections and access | Sees exactly which decisions are holding up work |
| Contractor workspace across projects | Tracks amounts due, site needs and assigned tasks | Receives attention within an organized workflow |
| Private estimate and margin workspace | Supports sustainable quotes without exposing unrelated company data | Agreed project records remain available under the contract |
| Approved public portfolio | Turns completed work into future leads | Can assess examples shared with permission |
| Purchasing comparisons and equipment reminders | Can reduce waste, idle hire time and sourcing effort | Gets a clearer explanation of operational choices |

Payment reminders must distinguish requested, approved, due, overdue and disputed amounts. They cannot imply automatic payment or a guaranteed turnaround. A proposed pilot target is an owner response within two business days, measured rather than promised.

### 37.3 Permission and accounting boundaries

Create contractor-company estimates and production-cost records separately from owner-project records. Access depends on company membership, project role and agreement disclosure rules. Owner-visible approved prices, reimbursable costs, signed terms, acceptance records and invoices cannot be hidden by a contractor toggling a privacy setting. Suppliers and workers cannot see company margins merely because they participate in a project. Include these boundaries in exports and authorization tests.

Add commercial_basis and disclosure_policy_version to work packages. Use separate entities for InternalEstimate, EstimateRevision, Quote, QuoteRevision, ContractMilestone and PaymentClaim. An accepted quote creates an immutable agreement revision and the corresponding owner budget or commitment; it does not itself create a paid expense. Internal estimated profit is selling price minus estimated production cost. Report actual gross margin only from a clearly specified set of posted contractor costs; do not present it as net profit before overhead, tax and other applicable expenses.

Owner funds entrusted to a contractor remain governed by the custody and reimbursable-cost rules. Private margin features must not conceal missing entrusted funds, misstate receipts, change agreed prices or erase financial history. Savings belong to the party specified in the agreement. Supplier rebates or procurement commissions must follow the disclosure arrangement; never label an invented receipt as an actual cost.

### 37.4 Adoption experiment and release priority

Interview 8 to 12 contractors with different project sizes. Ask them to demonstrate their current quotation, weekly reporting and payment follow-up process using anonymized examples. Recruit a small pilot group around their own active projects. The contractor creates a project and a sample report first; the owner then receives an invitation with a simple explanation of benefits and permissions. A contractor cannot impersonate an owner or approve their own claim where independent acceptance is required.

For A0, ship reusable quotation fields, funding requests, milestone payment claims, change records, report generation and a compact list of amounts due across assigned projects. A1 adds detailed internal estimating, company production costs and margin analytics. Portfolio publishing and lead generation remain later modules, requiring owner consent before sharing images, addresses or project details.

Test the pitch 'Spend less time reporting and make payment requests easier to review.' Measure contractors who create a usable quotation, invite an owner, publish reports for four consecutive weeks and return with another project. Measure owner acceptance and disputes alongside contractor retention. Offer a time-limited pilot or a small free project allowance as an experiment; final pricing should depend on willingness-to-pay interviews and support cost. Avoid incentives for exaggerated project values, unsupported progress claims or undisclosed markups.

## Appendix A Example end to end customer journey

Yann creates a Kigali house project for an owner living abroad. The owner confirms membership, selects RWF and the project timezone, approves the initial budget, and invites a contractor and supervisor. The contractor schedules foundation work and submits a cement request. The owner sees the request's quantities, quotation, budget effect, and required date, then approves the exact revision.

In the A1 procurement journey, the contractor issues the purchase order. The supplier submits a delivery note for 40 bags; the receiver accepts 38 and rejects two damaged bags. Stock increases by 38 bags. The missing accepted quantity remains open for replacement. Finance posts the invoice according to what is contractually payable and records the discrepancy until it is resolved; delivery confirmation alone does not determine the invoice amount.

The supervisor records 25 bags issued to foundation work, uploads a daily update, and identifies rain as a blocker. The owner receives a weekly report with physical progress, cost, remaining commitment, stock, and a pending decision. An inspector visits the foundation, records a finding, and requires correction. The stage remains unaccepted until the correction is verified and the owner accepts it.

The owner later changes a room layout. A change order shows the new drawing revision, additional cost, and revised schedule. Approval and application update the budget and schedule without erasing the original baseline. At completion, the owner receives a handover package containing accepted work, final spending, drawings, reports, remaining items, and warranties. The project becomes read only with accessible exports.

## Appendix B Developer handoff checklist

- Build project-scoped authorization before exposing any construction record.
- Publish the OpenAPI contract and migration model for each released module.
- Implement controlled state transitions rather than client-edited status fields.
- Separate cost, commitment, payment, evidence, approval, and acceptance.
- Make reservations, allocations, stock postings, and change application transactional and idempotent.
- Preserve submitted revisions, signed reports, financial corrections, and audit attribution.
- Keep files private and scope every upload, download, search, and export.
- Support offline capture with explicit synchronization and conflict states.
- Implement all user-visible error, empty, loading, expired, and revoked-access states.
- Deliver role-appropriate mobile and web navigation with accessible controls.
- Verify the financial example, partial delivery, failed inspection, and cross-project denial end to end.
- Configure backups, restore drills, monitoring, support, and partner responsibilities before launch.

## Appendix C Glossary

Bill of quantities means the structured list of work or materials, units, quantities, rates, and costs. Commitment means an approved obligation not yet converted to posted cost. Posted cost means a recognized project invoice or expense in this operational system. Cash paid means a verified settled outgoing payment. An advance is a payment made before invoice allocation. Retention is an agreed amount withheld pending a release condition. A change order is an approved change to scope, budget, or schedule. A defect is recorded work that requires correction. Acceptance is an authorized acknowledgement that a stage meets its project conditions. An inspection outcome is a qualified review within a stated scope. Evidence is a record supporting a claim, with its origin and limitations visible. An audit trail records who performed significant actions and when. Idempotency means repeating the same operation does not repeat its effects. An ETag identifies a resource revision used to prevent stale writes. A sync conflict means local changes cannot safely replace the current server record without review.
