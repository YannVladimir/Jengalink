// View models the apps render. The API will return these shapes; until the
// endpoints exist, the demo fixtures in ./demo fill them with synthetic data.

export type Role = 'owner' | 'contractor' | 'supervisor';

export type StageStatus =
  | 'planned'
  | 'in_progress'
  | 'ready_for_review'
  | 'accepted'
  | 'blocked'
  | 'changes_required';

export interface StageView {
  id: string;
  name: string;
  status: StageStatus;
  /** Share of total progress; all stages add up to 100. */
  weight: number;
  plannedEnd: string;
  currentEnd: string;
  acceptanceCriteria: string[];
}

export interface PhotoView {
  id: string;
  capturedAt: string;
  caption: string;
  /** Placeholder art variant until real media exists (0–5). */
  tone: number;
}

export type DemoClaimStatus = 'submitted' | 'approved' | 'paid' | 'changes_requested' | 'disputed';

export interface DemoClaimView {
  id: string;
  number: number;
  stageId: string;
  stageName: string;
  title: string;
  /** Whole RWF. */
  amount: number;
  status: DemoClaimStatus;
  requestedAt: string;
  approvedAt?: string;
  paidAt?: string;
  requestedBy: string;
  note: string;
  lineItems: { label: string; amount: number }[];
  photos: PhotoView[];
}

export type UpdateStatus = 'reported' | 'accepted' | 'problem';

export interface SiteUpdateView {
  id: string;
  stageId: string;
  stageName: string;
  author: string;
  authorRole: Role;
  createdAt: string;
  note: string;
  blockers?: string;
  status: UpdateStatus;
  photos: PhotoView[];
}

export interface DemoPaymentView {
  id: string;
  claimNumber: number;
  amount: number;
  method: 'momo' | 'bank' | 'cash';
  recordedAt: string;
  status: 'pending_verification' | 'settled';
}

export interface DecisionView {
  id: string;
  kind: 'claim' | 'stage_review' | 'budget_change';
  title: string;
  subtitle: string;
  amount?: number;
  waitingSince: string;
  /** Route in the apps, e.g. /claim/c5 */
  href: string;
}

export interface FloatView {
  custodian: string;
  expected: number;
  counted: number;
  lastCountAt: string;
}

export interface TeamMember {
  name: string;
  role: Role;
  detail: string;
}

export interface ProjectView {
  id: string;
  name: string;
  location: string;
  contractValue: number;
  updatedAt: string;
  stages: StageView[];
  claims: DemoClaimView[];
  updates: SiteUpdateView[];
  payments: DemoPaymentView[];
  decisions: DecisionView[];
  float: FloatView;
  team: TeamMember[];
}
