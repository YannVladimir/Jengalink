import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AcceptanceDecisionRequest,
  clampWeight,
  moveStage,
  planDraftToRequest,
  planProblems,
  rebalanceWeights,
  SaveStagePlanRequest,
  spreadTo100,
  StageDrafts,
  stageTemplates,
  toPlanDraft,
  weightGap,
} from "./planning";

test("every stage template totals 100 and passes the API rule", () => {
  for (const [type, stages] of Object.entries(stageTemplates)) {
    assert.equal(
      stages.reduce((s, x) => s + x.weight, 0),
      100,
      type,
    );
    assert.ok(
      StageDrafts.safeParse(
        stages.map((s) => ({ name: s.key, weight: s.weight })),
      ).success,
      type,
    );
  }
});

test("rebalanceWeights keeps proportions and always totals 100", () => {
  // House without the 15% roof: 85 points spread back over 7 stages.
  const out = rebalanceWeights([5, 15, 20, 10, 10, 15, 10]);
  assert.equal(
    out.reduce((s, w) => s + w, 0),
    100,
  );
  assert.deepEqual(out, [6, 18, 23, 12, 12, 17, 12]);
  assert.deepEqual(rebalanceWeights([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(rebalanceWeights([0, 0]), [50, 50]);
  assert.deepEqual(rebalanceWeights([]), []);
});

test("adding and removing stages keeps the total at 100", async () => {
  const { withStageAdded, withStageRemoved } = await import("./planning");
  const four = [
    { name: "A", weight: 25 },
    { name: "B", weight: 25 },
    { name: "C", weight: 25 },
    { name: "D", weight: 25 },
  ];
  const five = withStageAdded(four, "E");
  assert.deepEqual(
    five.map((s) => s.weight),
    [20, 20, 20, 20, 20],
  );
  const three = withStageRemoved(four, 1);
  assert.deepEqual(
    three.map((s) => s.name),
    ["A", "C", "D"],
  );
  assert.equal(
    three.reduce((t, s) => t + s.weight, 0),
    100,
  );
});

test("a stage plan needs weights totalling 100, ordered dates and short criteria", () => {
  const ok = SaveStagePlanRequest.safeParse({
    stages: [
      {
        name: "Foundation",
        weight: 60,
        plannedStart: "2026-11-02",
        plannedEnd: "2026-11-30",
        criteria: ["Footings poured and cured 7 days"],
      },
      { name: "Walls", weight: 40 },
    ],
  });
  assert.ok(ok.success);
  assert.deepEqual(ok.data.stages[1].criteria, []);

  const badTotal = SaveStagePlanRequest.safeParse({
    stages: [{ name: "Foundation", weight: 90 }],
  });
  assert.ok(!badTotal.success);
  const badDates = SaveStagePlanRequest.safeParse({
    stages: [
      {
        name: "Foundation",
        weight: 100,
        plannedStart: "2026-12-01",
        plannedEnd: "2026-11-01",
      },
    ],
  });
  assert.ok(!badDates.success);
  assert.equal(badDates.error.issues[0].path.join("."), "stages.0.plannedEnd");
  const tooMany = SaveStagePlanRequest.safeParse({
    stages: [
      {
        name: "Foundation",
        weight: 100,
        criteria: Array.from({ length: 11 }, (_, i) => `Check number ${i}`),
      },
    ],
  });
  assert.ok(!tooMany.success);
  assert.equal(weightGap([{ weight: 30 }, { weight: 50 }]), 20);
});

test("the plan editor helpers keep the plan saveable", () => {
  const draft = toPlanDraft([
    {
      id: "0190a5a0-0000-7000-8000-000000000001",
      name: "Foundation",
      position: 1,
      weight: 50,
      status: "not_started",
      description: null,
      plannedStart: null,
      plannedEnd: null,
      criteria: [],
    },
    {
      id: "0190a5a0-0000-7000-8000-000000000002",
      name: "Walls",
      position: 2,
      weight: 50,
      status: "not_started",
      description: null,
      plannedStart: null,
      plannedEnd: null,
      criteria: [],
    },
  ]);
  assert.ok(planProblems(draft).ok);
  const nudged = draft.map((s, i) =>
    i === 0 ? { ...s, weight: clampWeight(s.weight + 10) } : s,
  );
  assert.equal(planProblems(nudged).total, 110);
  assert.deepEqual(
    spreadTo100(nudged).map((s) => s.weight),
    [55, 45],
  );
  const late = draft.map((s, i) =>
    i === 1
      ? { ...s, plannedStart: "2026-12-01", plannedEnd: "2026-11-01" }
      : s,
  );
  assert.deepEqual(planProblems(late).badDates, [1]);
  assert.deepEqual(
    moveStage(draft, 1, -1).map((s) => s.name),
    ["Walls", "Foundation"],
  );
  const req = planDraftToRequest([
    { ...draft[0], description: "  ", criteria: [" Level checked ", ""] },
    draft[1],
  ]);
  assert.equal(req.stages[0].description, null);
  assert.deepEqual(req.stages[0].criteria, ["Level checked"]);
  assert.ok(SaveStagePlanRequest.safeParse(req).success);
});

test("asking for changes needs a note; accepting does not", () => {
  assert.ok(
    AcceptanceDecisionRequest.safeParse({ decision: "accept" }).success,
  );
  const bare = AcceptanceDecisionRequest.safeParse({
    decision: "request_changes",
  });
  assert.ok(!bare.success);
  assert.equal(bare.error.issues[0].path.join("."), "note");
  assert.ok(
    AcceptanceDecisionRequest.safeParse({
      decision: "request_changes",
      note: "Roof share is too high",
    }).success,
  );
  const withValue = planDraftToRequest([], 45_000_000);
  assert.equal(withValue.contractValue, 45_000_000);
  assert.ok(!("contractValue" in planDraftToRequest([])));
});

test("a site update needs a photo or a short note, and reads EXIF capture times", async () => {
  const { CreateSiteUpdateRequest, exifToIso } = await import("./updates");
  const stageId = "0190a5a0-0000-7000-8000-000000000001";
  assert.ok(!CreateSiteUpdateRequest.safeParse({ stageId }).success);
  assert.ok(
    CreateSiteUpdateRequest.safeParse({ stageId, note: "Poured the slab" })
      .success,
  );
  assert.ok(
    CreateSiteUpdateRequest.safeParse({
      stageId,
      photos: [
        { uploadKey: "tmp/p/x", capturedAt: "2026-11-02T14:05:09+02:00" },
      ],
    }).success,
  );
  assert.ok(
    !CreateSiteUpdateRequest.safeParse({
      stageId,
      photos: Array.from({ length: 11 }, (_, i) => ({ uploadKey: `k${i}` })),
    }).success,
  );
  assert.equal(exifToIso("2026:11:02 14:05:09"), "2026-11-02T14:05:09+02:00");
  assert.equal(exifToIso(undefined), null);
  assert.equal(exifToIso("garbage"), null);
});

test('progress counts accepted weight only; review is "reported"; blockers and updates show on the tower', async () => {
  const { displayStatusOf, progressPercents } = await import("./progress");
  const stages = [
    { weight: 15, status: "accepted" as const, updateCount: 4, blocker: null },
    {
      weight: 20,
      status: "ready_for_review" as const,
      updateCount: 2,
      blocker: null,
    },
    {
      weight: 25,
      status: "not_started" as const,
      updateCount: 1,
      blocker: "Cement late",
    },
    {
      weight: 30,
      status: "not_started" as const,
      updateCount: 3,
      blocker: null,
    },
    {
      weight: 10,
      status: "not_started" as const,
      updateCount: 0,
      blocker: null,
    },
  ];
  assert.deepEqual(progressPercents(stages), {
    acceptedPercent: 15,
    reportedPercent: 20,
  });
  assert.deepEqual(stages.map(displayStatusOf), [
    "accepted",
    "ready_for_review",
    "blocked",
    "in_progress",
    "planned",
  ]);
  assert.deepEqual(progressPercents([]), {
    acceptedPercent: 0,
    reportedPercent: 0,
  });
});

test("the next action fits the role: owners review, contractors keep things moving", async () => {
  const { nextActionFor } = await import("./progress");
  const now = Date.parse("2026-10-09T12:00:00Z");
  const stage = (id: string, status: string, displayStatus: string) =>
    ({ id, name: id, status, displayStatus }) as never;
  const base = {
    status: "active" as const,
    hasOwner: true,
    contractValue: 1,
    lastUpdateAt: "2026-10-09T08:00:00Z",
    stages: [],
  };
  const ready = [stage("Walls", "ready_for_review", "ready_for_review")];
  assert.equal(
    nextActionFor({ ...base, myRoles: ["owner"], stages: ready }, now).kind,
    "review_stage",
  );
  assert.equal(
    nextActionFor(
      { ...base, myRoles: ["owner"], status: "draft", stages: ready },
      now,
    ).kind,
    "accept_project",
  );
  assert.equal(
    nextActionFor(
      { ...base, myRoles: ["contractor"], status: "draft", hasOwner: false },
      now,
    ).kind,
    "invite_owner",
  );
  assert.equal(
    nextActionFor(
      {
        ...base,
        myRoles: ["contractor"],
        status: "draft",
        contractValue: null,
      },
      now,
    ).kind,
    "plan_project",
  );
  assert.equal(
    nextActionFor(
      { ...base, myRoles: ["contractor"], status: "draft", stages: ready },
      now,
    ).kind,
    "await_owner",
  );
  const mixed = [
    stage("Roof", "changes_required", "changes_required"),
    stage("Walls", "in_progress", "blocked"),
  ];
  assert.deepEqual(
    nextActionFor({ ...base, myRoles: ["contractor"], stages: mixed }, now),
    { kind: "fix_changes", stageId: "Roof", stageName: "Roof" },
  );
  assert.equal(
    nextActionFor({ ...base, myRoles: ["supervisor"], stages: mixed }, now)
      .kind,
    "clear_blocker",
  );
  assert.equal(
    nextActionFor(
      {
        ...base,
        myRoles: ["contractor"],
        lastUpdateAt: "2026-10-01T08:00:00Z",
      },
      now,
    ).kind,
    "post_update",
  );
  assert.equal(
    nextActionFor({ ...base, myRoles: ["contractor"] }, now).kind,
    "none",
  );
});

test("quotes: milestones split the total by stage share and always add up; a total is required", async () => {
  const { milestonesFromStages, quoteTotal, SaveQuoteRequest } =
    await import("./quotes");
  const stages = [
    {
      id: "0190a5a0-0000-7000-8000-000000000001",
      name: "Foundation",
      weight: 33,
    },
    { id: "0190a5a0-0000-7000-8000-000000000002", name: "Walls", weight: 33 },
    { id: "0190a5a0-0000-7000-8000-000000000003", name: "Roof", weight: 34 },
  ];
  const ms = milestonesFromStages(stages, 45_000_001);
  assert.equal(quoteTotal(ms), 45_000_001);
  assert.deepEqual(
    ms.map((m) => m.stageId),
    stages.map((s) => s.id),
  );
  const base = {
    title: "House",
    scope: "Build a house",
    validUntil: "2026-11-30",
  };
  assert.ok(SaveQuoteRequest.safeParse({ ...base, milestones: ms }).success);
  assert.ok(
    !SaveQuoteRequest.safeParse({
      ...base,
      milestones: [{ name: "Free", amount: 0 }],
    }).success,
  );
  assert.ok(!SaveQuoteRequest.safeParse({ ...base, milestones: [] }).success);
});

test("commercial basis: fixed, reimbursable or hybrid; private margin needs every cost", async () => {
  const { quoteBasisOf, marginOf, withFee, QuoteMilestoneInput } =
    await import("./quotes");
  assert.equal(quoteBasisOf([{ basis: "fixed" }, {}]), "fixed");
  assert.equal(quoteBasisOf([{ basis: "reimbursable" }]), "reimbursable");
  assert.equal(
    quoteBasisOf([{ basis: "fixed" }, { basis: "reimbursable" }]),
    "hybrid",
  );
  assert.deepEqual(marginOf([{ amount: 5_000_000 }], [4_000_000]), {
    totalCost: 4_000_000,
    margin: 1_000_000,
    marginPercent: 20,
  });
  assert.deepEqual(
    marginOf([{ amount: 5_000_000 }, { amount: 1 }], [4_000_000, null]),
    { totalCost: null, margin: null, marginPercent: null },
  );
  assert.equal(withFee(10_000_000, 12.5), 11_250_000);
  assert.ok(
    !QuoteMilestoneInput.safeParse({
      name: "Plumbing",
      amount: 1000,
      basis: "reimbursable",
    }).success,
  );
  assert.ok(
    QuoteMilestoneInput.safeParse({
      name: "Plumbing",
      amount: 1000,
      basis: "reimbursable",
      feePercent: 10,
    }).success,
  );
});

test("claimProblems: amount, the fixed-price ceiling and evidence", async () => {
  const { claimProblems, SaveClaimRequest } = await import("./claims");
  assert.deepEqual(
    claimProblems({ amount: 2_000_000, evidence: 1, remaining: 2_000_000 }),
    [],
  );
  assert.deepEqual(
    claimProblems({ amount: 2_000_001, evidence: 1, remaining: 2_000_000 }),
    ["overClaim"],
  );
  assert.deepEqual(
    claimProblems({ amount: 9_000_000, evidence: 0, remaining: null }),
    ["evidence"],
  );
  assert.deepEqual(claimProblems({ amount: null, evidence: 2, remaining: 5 }), [
    "amount",
  ]);
  const parsed = SaveClaimRequest.parse({ milestoneIndex: 0, amount: 100 });
  assert.deepEqual(
    [parsed.siteUpdateIds, parsed.files, parsed.removeFileIds],
    [[], [], []],
  );
});

test("ClaimDecisionRequest: a reason is needed to reject or ask for changes", async () => {
  const { ClaimDecisionRequest } = await import("./claims");
  assert.ok(
    ClaimDecisionRequest.safeParse({ decision: "approve", amount: 10 }).success,
  );
  assert.ok(
    !ClaimDecisionRequest.safeParse({ decision: "reject", amount: 10 }).success,
  );
  assert.ok(
    !ClaimDecisionRequest.safeParse({
      decision: "request_changes",
      amount: 10,
      note: "no",
    }).success,
  );
  assert.ok(
    ClaimDecisionRequest.safeParse({
      decision: "request_changes",
      amount: 10,
      note: "Add the invoice",
    }).success,
  );
});

test("spending maths: integer line amounts, rounded lines, cost budget without the fee", async () => {
  const { lineAmount, spendingTotal, costBudgetOf, SaveSpendingRequest } =
    await import("./spending");
  assert.equal(lineAmount("40", 15_000), 600_000);
  assert.equal(lineAmount("12.5", 3_333), 41_663); // 41,662.5 rounds up
  assert.equal(lineAmount("0.001", 1_000_000_000), 1_000_000);
  assert.equal(
    spendingTotal([
      { quantity: "1.5", unitRate: 3 },
      { quantity: "1.5", unitRate: 3 },
    ]),
    10,
  ); // 5 + 5, not round(9)
  assert.equal(costBudgetOf(5_500_000, 10), 5_000_000);
  assert.equal(costBudgetOf(1_000_000, null), 1_000_000);
  const bad = SaveSpendingRequest.safeParse({
    milestoneIndex: 0,
    purpose: "Cement",
    lines: [
      { description: "Cement", quantity: "1.2345", unit: "bag", unitRate: 10 },
    ],
  });
  assert.ok(!bad.success);
  const huge = SaveSpendingRequest.safeParse({
    milestoneIndex: 0,
    purpose: "Cement",
    lines: [
      {
        description: "Cement",
        quantity: "9999999.999",
        unit: "bag",
        unitRate: 1_000_000_000,
      },
    ],
  });
  assert.ok(!huge.success);
});

test("receipt fields: 9-digit TINs, VAT within the total, a reason for a discrepancy", async () => {
  const { SaveReceiptRequest, ReviewReceiptRequest } =
    await import("./spending");
  const base = {
    supplierName: "Kigali Hardware",
    invoiceNumber: "000123",
    invoiceDate: "2026-10-09",
    total: 500_000,
  };
  assert.ok(
    SaveReceiptRequest.safeParse({
      ...base,
      supplierTin: "102345678",
      vatAmount: 76_271,
    }).success,
  );
  assert.ok(
    !SaveReceiptRequest.safeParse({ ...base, supplierTin: "10234" }).success,
  );
  assert.ok(
    !SaveReceiptRequest.safeParse({ ...base, vatAmount: 600_000 }).success,
  );
  assert.ok(
    ReviewReceiptRequest.safeParse({ status: "manually_reviewed" }).success,
  );
  assert.ok(
    !ReviewReceiptRequest.safeParse({ status: "discrepancy_found" }).success,
  );
  assert.ok(
    !ReviewReceiptRequest.safeParse({ status: "externally_confirmed" }).success,
  );
});

test("payment records: a reference except for cash, a reason for a dispute", async () => {
  const { RecordPaymentRequest, VerifyPaymentRequest } =
    await import("./payments");
  const base = {
    payer: "Aline Uwase",
    beneficiary: "Ubaka Builders",
    amount: 9_000_000,
    paymentDate: "2026-10-10",
  };
  assert.ok(
    RecordPaymentRequest.safeParse({ ...base, method: "cash" }).success,
  );
  assert.ok(
    !RecordPaymentRequest.safeParse({ ...base, method: "mtn_momo" }).success,
  );
  assert.ok(
    RecordPaymentRequest.safeParse({
      ...base,
      method: "mtn_momo",
      reference: "MP261010.1234.A56789",
    }).success,
  );
  assert.ok(VerifyPaymentRequest.safeParse({ decision: "settle" }).success);
  assert.ok(!VerifyPaymentRequest.safeParse({ decision: "dispute" }).success);
});

test("money: still to come never goes below zero; actions add up", async () => {
  const { stillToCome, actionCount } = await import("./money");
  assert.equal(
    stillToCome({
      contract: 23_500_000,
      paid: 9_000_000,
      approvedUnpaid: 1_000_000,
    }),
    13_500_000,
  );
  assert.equal(stillToCome({ contract: 5, paid: 3, approvedUnpaid: 3 }), 0);
  assert.equal(
    actionCount({
      claimsToDecide: 1,
      paymentsToConfirm: 2,
      spendingToDecide: 0,
      receiptsMissing: 3,
    }),
    6,
  );
});

test("budget changes: one package per line, new packages add money, floors respect the fee", async () => {
  const { SaveBudgetChangeRequest, reimbursableFloor } =
    await import("./changes");
  const { costBudgetOf } = await import("./spending");
  const base = {
    category: "owner_request",
    reason: "Bigger windows on the east side",
  };
  assert.ok(
    SaveBudgetChangeRequest.safeParse({
      ...base,
      lines: [{ milestoneIndex: 0, delta: 500_000 }],
    }).success,
  );
  assert.ok(
    !SaveBudgetChangeRequest.safeParse({
      ...base,
      lines: [
        { milestoneIndex: 0, delta: 1 },
        { milestoneIndex: 0, delta: 2 },
      ],
    }).success,
  );
  assert.ok(
    !SaveBudgetChangeRequest.safeParse({
      ...base,
      lines: [{ newPackage: { name: "Gate" }, delta: -5 }],
    }).success,
  );
  assert.ok(
    !SaveBudgetChangeRequest.safeParse({
      ...base,
      lines: [{ milestoneIndex: 0, delta: 0 }],
    }).success,
  );
  assert.ok(
    SaveBudgetChangeRequest.safeParse({
      ...base,
      lines: [
        {
          newPackage: { name: "Gate", basis: "reimbursable", feePercent: 10 },
          delta: 800_000,
        },
      ],
    }).success,
  );
  for (const [used, fee] of [
    [675_000, 10],
    [1, 12.5],
    [5_000_000, null],
  ] as const) {
    const e = reimbursableFloor(used, fee);
    assert.ok(costBudgetOf(e, fee) >= used);
    assert.ok(costBudgetOf(e - 1, fee) < used);
  }
  assert.equal(reimbursableFloor(0, 10), 0);
});

test("weekOf: Monday to Sunday, whatever day it is", async () => {
  const { weekOf } = await import("./reports");
  assert.deepEqual(weekOf("2026-10-11"), {
    start: "2026-10-05",
    end: "2026-10-11",
  }); // a Sunday
  assert.deepEqual(weekOf("2026-10-12"), {
    start: "2026-10-12",
    end: "2026-10-18",
  }); // a Monday
  assert.deepEqual(weekOf("2026-01-01"), {
    start: "2025-12-29",
    end: "2026-01-04",
  }); // across the year
});

test("sharedReportData: no names, district only, chosen sections, amounts only with money", async () => {
  const { sharedReportData } = await import("./reports");
  const data = {
    projectName: "Rebero house",
    organizationName: "Ubaka Builders",
    place: "Gatenga, Kicukiro",
    progress: { accepted: 40, reported: 20, acceptedChange: 5 },
    stages: [
      { name: "Foundation", weight: 100, status: "in_progress" as const },
    ],
    work: {
      updates: 2,
      photos: 2,
      authors: ["Eric Mugisha"],
      stagesWorked: ["Foundation"],
      blockers: [],
    },
    decisions: [
      {
        kind: "claim" as const,
        title: "C-2026-0001 · Foundation",
        amount: 2_000_000,
        since: "2026-10-10T08:00:00.000Z",
      },
    ],
    next: [{ stage: "Walls", plannedStart: "2026-10-20" }],
    money: {
      contract: 10,
      paid: 1,
      approvedUnpaid: 2,
      awaitingDecision: 3,
      pendingVerification: 0,
      advances: 0,
    },
    spending: null,
    photoIds: ["0190f000-0000-7000-8000-000000000001"],
  };
  const lean = sharedReportData(data as never, ["decisions"]);
  assert.equal(lean.place, "Kicukiro");
  assert.deepEqual(lean.work, {
    updates: 0,
    photos: 0,
    authors: [],
    stagesWorked: [],
    blockers: [],
  });
  assert.equal(lean.decisions[0].amount, null);
  assert.deepEqual([lean.next, lean.photoIds, lean.money], [[], [], null]);
  assert.deepEqual(lean.progress, data.progress); // progress and the tower are always shown
  const full = sharedReportData(data as never, [
    "work",
    "photos",
    "decisions",
    "next",
    "money",
  ]);
  assert.deepEqual(full.work.authors, []);
  assert.equal(full.decisions[0].amount, 2_000_000);
  assert.equal(full.money, data.money);
});

test("quiet hours follow the local clock and may cross midnight", async () => {
  const { inQuietHours, localClock } = await import("./notifications");
  const tz = "Africa/Kigali"; // UTC+2
  const at = (utc: string) => new Date(`2026-10-11T${utc}:00Z`);
  const night = { start: "21:00", end: "07:00" };
  assert.equal(localClock(at("20:30"), tz).time, "22:30");
  assert.equal(inQuietHours(at("20:30"), night, tz), true); // 22:30
  assert.equal(inQuietHours(at("04:59"), night, tz), true); // 06:59
  assert.equal(inQuietHours(at("05:00"), night, tz), false); // 07:00
  assert.equal(inQuietHours(at("12:00"), night, tz), false); // 14:00
  assert.equal(
    inQuietHours(at("12:00"), { start: "13:00", end: "15:00" }, tz),
    true,
  ); // same-day window
  assert.equal(inQuietHours(at("12:00"), null, tz), false);
  assert.equal(localClock(at("22:30"), tz).date, "2026-10-12"); // after local midnight
});

test("CSV: quotes, line breaks, BOM, and formulas kept as text", async () => {
  const { csvCell, toCsv } = await import("./exports");
  assert.equal(csvCell("Cement, 40 bags"), '"Cement, 40 bags"');
  assert.equal(csvCell('He said "ok"'), '"He said ""ok"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("-5"), "'-5");
  assert.equal(csvCell(-5), "-5"); // numbers stay numbers
  assert.equal(csvCell(null), "");
  assert.equal(
    toCsv([
      ["a", 1],
      ["b", "x\ny"],
    ]),
    '﻿a,1\r\nb,"x\ny"\r\n',
  );
});
