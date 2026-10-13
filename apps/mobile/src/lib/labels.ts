import type { DemoClaimView } from '@jengalink/contracts';
import type { MessageKey } from '@jengalink/i18n';
import type { Status } from '@jengalink/ui';

/** Badge colour + translated word for each claim state. */
export const claimBadge: Record<DemoClaimView['status'], { status: Status; label: MessageKey }> = {
  submitted: { status: 'waiting', label: 'status.waiting' },
  approved: { status: 'approved', label: 'status.approved' },
  paid: { status: 'paid', label: 'status.paid' },
  changes_requested: { status: 'waiting', label: 'status.changesAsked' },
  disputed: { status: 'problem', label: 'status.disputed' },
};
