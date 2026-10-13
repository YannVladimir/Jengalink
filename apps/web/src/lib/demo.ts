// Demo data access for the web workspace. Swapped for API calls once endpoints exist.
import type { DemoClaimView } from '@jengalink/contracts';
import { demoProject, projectFigures } from '@jengalink/contracts/demo';
import type { MessageKey } from '@jengalink/i18n';
import type { Status } from '@jengalink/ui';

export const project = demoProject;
export const figures = projectFigures(demoProject);

export const findClaim = (id: string) => project.claims.find((c) => c.id === id);

export const claimBadge: Record<DemoClaimView['status'], { status: Status; label: MessageKey }> = {
  submitted: { status: 'waiting', label: 'status.waiting' },
  approved: { status: 'approved', label: 'status.approved' },
  paid: { status: 'paid', label: 'status.paid' },
  changes_requested: { status: 'waiting', label: 'status.changesAsked' },
  disputed: { status: 'problem', label: 'status.disputed' },
};

/** Decisions carry app routes (/claim/:id, /stage/:id); map them to web routes. */
export function webHref(d: { kind: string; href: string }): string {
  const id = d.href.split('/').pop() ?? '';
  return d.kind === 'claim' ? `/money/claims/${id}` : '/updates';
}
