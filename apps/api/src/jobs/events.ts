// Every event the system emits, with its payload. Add new events here first.
export interface EventPayloads {
  /** Smoke-test event used by the jobs tests and the health tooling. */
  'system.ping': { note: string };
  /** A project or organization invitation was created; the notifier sends the SMS or email. */
  'invitation.created': { invitationId: string };
  /** A site update was posted (notifications and the activity feed later). */
  'site_update.submitted': {
    siteUpdateId: string;
    projectId: string;
    photos: number;
    hasBlockers: boolean;
  };
  /** Files were attached to a payment claim: scan them (and thumbnail photos). */
  'claim.files_added': { claimId: string; projectId: string };
  /** A payment claim was sent to the owner. */
  'claim.submitted': {
    claimId: string;
    projectId: string;
    amount: number;
    /** 2 and later: the contractor changed a claim already sent. */
    revisionNo: number;
    /** It cancelled the owner's approval of the revision before. */
    cancelledApproval: boolean;
  };
  /** The owner approved, rejected or asked for changes on a claim. */
  'claim.decided': {
    claimId: string;
    projectId: string;
    decision: 'approved' | 'rejected' | 'changes_requested';
    amount: number;
  };
  /** Quotations were attached to a spending request: scan them. */
  'spending.files_added': { requestId: string; projectId: string };
  /** A spending request was sent to the owner. */
  'spending.submitted': {
    requestId: string;
    projectId: string;
    amount: number;
  };
  /** The owner answered a spending request (approval reserved the amount). */
  'spending.decided': {
    requestId: string;
    projectId: string;
    decision: 'approved' | 'rejected' | 'changes_requested';
    amount: number;
  };
  /** A direct expense was posted against an approved request. */
  'expense.posted': {
    expenseId: string;
    requestId: string;
    projectId: string;
    amount: number;
  };
  /** A receipt photo or PDF was attached: scan it. */
  'receipt.files_added': { receiptId: string; projectId: string };
  /** Proof of payment was attached: scan it. */
  'payment.files_added': { paymentId: string; projectId: string };
  /** A payment made outside JengaLink was recorded (pending verification). */
  'payment.recorded': {
    paymentId: string;
    projectId: string;
    amount: number;
    claimId: string | null;
  };
  /** A payment was confirmed (settled) or disputed. */
  'payment.verified': {
    paymentId: string;
    projectId: string;
    decision: 'settled' | 'disputed';
  };
  /** Evidence was attached to a budget change: scan it. */
  'change.files_added': { changeId: string; projectId: string };
  /** A budget change was sent to the owner. */
  'change.submitted': { changeId: string; projectId: string; netDelta: number };
  /** The owner applied (a new agreement version) or rejected a budget change. */
  'change.decided': {
    changeId: string;
    projectId: string;
    decision: 'applied' | 'rejected';
    netDelta: number;
  };
  /** Someone asked for an export: build the file from one snapshot. */
  'export.requested': { exportId: string; projectId: string };
  /** Notifications were created: push them to their people's phones. */
  'notification.created': { notificationIds: string[] };
  /** A weekly report was generated (people are notified). */
  'report.published': {
    reportId: string;
    projectId: string;
    weekStart: string;
  };
  /** A quote revision was sent to the owner (notifications later). */
  'quote.sent': { quoteId: string; projectId: string; revision: number };
  /** The owner accepted or declined a quote revision. */
  'quote.decided': {
    quoteId: string;
    projectId: string;
    revision: number;
    decision: 'accepted' | 'declined';
  };
  /** A stage was submitted for review, accepted, or sent back with changes. */
  'stage.reviewed': {
    reviewId: string;
    projectId: string;
    stageId: string;
    kind: 'submitted' | 'accepted' | 'changes_requested';
  };
  /** The owner accepted the baseline or asked for changes (notifications and analytics later). */
  'project.decided': {
    acceptanceId: string;
    projectId: string;
    decision: 'accepted' | 'changes_requested';
  };
}

export type EventType = keyof EventPayloads;

export interface EventEnvelope<T extends EventType = EventType> {
  eventId: string;
  type: T;
  occurredAt: string;
  payload: EventPayloads[T];
}

/** One pg-boss queue per (event, consumer): pg-boss names allow only [A-Za-z0-9_-]. */
export const queueName = (type: EventType, consumer: string) =>
  `${type.replace(/\./g, '-')}__${consumer}`;
