// Synthetic demo project (spec §34: seed data and demo fixtures). Names are invented.
// Numbers are consistent: claims add up to the money bar, stage weights to 100.
import type {
  DemoClaimView,
  PhotoView,
  ProjectView,
  SiteUpdateView,
  StageView,
} from './views';

const DAY = 86_400_000;
const ago = (days: number, hours = 0) =>
  new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const photo = (id: string, days: number, caption: string, tone: number): PhotoView => ({
  id,
  capturedAt: ago(days, 3),
  caption,
  tone,
});

const stages: StageView[] = [
  { id: 's1', name: 'Site preparation', status: 'accepted', weight: 5, plannedEnd: ago(80), currentEnd: ago(80), acceptanceCriteria: ['Site cleared and levelled', 'Setting-out checked against plan'] },
  { id: 's2', name: 'Foundation', status: 'accepted', weight: 15, plannedEnd: ago(60), currentEnd: ago(57), acceptanceCriteria: ['Footings at design depth', 'Concrete test cubes recorded'] },
  { id: 's3', name: 'Ground floor walls', status: 'accepted', weight: 15, plannedEnd: ago(38), currentEnd: ago(35), acceptanceCriteria: ['Walls plumb and level', 'Openings match drawings'] },
  { id: 's4', name: 'Ground floor slab', status: 'accepted', weight: 10, plannedEnd: ago(20), currentEnd: ago(18), acceptanceCriteria: ['Slab thickness 150 mm', 'Curing for 7 days logged'] },
  { id: 's5', name: 'First floor walls', status: 'ready_for_review', weight: 10, plannedEnd: ago(4), currentEnd: ago(2), acceptanceCriteria: ['Walls plumb and level', 'Lintels over all openings', 'Photos from every side'] },
  { id: 's6', name: 'Roof structure', status: 'in_progress', weight: 20, plannedEnd: ahead(14), currentEnd: ahead(23), acceptanceCriteria: ['Trusses fixed to ring beam', 'Bracing installed'] },
  { id: 's7', name: 'Finishes', status: 'planned', weight: 25, plannedEnd: ahead(60), currentEnd: ahead(69), acceptanceCriteria: ['Plaster, paint and fittings complete'] },
];

const p5 = [
  photo('p51', 2, 'First floor walls, north side', 0),
  photo('p52', 2, 'Lintel over main window', 1),
  photo('p53', 3, 'East wall, full height', 2),
];

const claims: DemoClaimView[] = [
  { id: 'c1', number: 1, stageId: 's2', stageName: 'Foundation', title: 'Foundation complete', amount: 3_600_000, status: 'paid', requestedAt: ago(56), approvedAt: ago(54), paidAt: ago(52), requestedBy: 'Ubaka Builders', note: 'Footings and plinth beam.', lineItems: [{ label: 'Labour', amount: 1_400_000 }, { label: 'Cement and steel', amount: 2_200_000 }], photos: [photo('p11', 57, 'Footings poured', 3)] },
  { id: 'c2', number: 2, stageId: 's3', stageName: 'Ground floor walls', title: 'Ground floor walls', amount: 3_600_000, status: 'paid', requestedAt: ago(34), approvedAt: ago(33), paidAt: ago(30), requestedBy: 'Ubaka Builders', note: 'All ground floor walls to ring beam.', lineItems: [{ label: 'Labour', amount: 1_300_000 }, { label: 'Blocks and mortar', amount: 2_300_000 }], photos: [photo('p21', 35, 'Ring beam', 4)] },
  { id: 'c3', number: 3, stageId: 's4', stageName: 'Ground floor slab', title: 'Slab, part 1 of 2', amount: 2_400_000, status: 'paid', requestedAt: ago(19), approvedAt: ago(18), paidAt: ago(16), requestedBy: 'Ubaka Builders', note: 'Formwork and steel fixing.', lineItems: [{ label: 'Formwork', amount: 900_000 }, { label: 'Steel', amount: 1_500_000 }], photos: [photo('p31', 19, 'Steel fixed', 5)] },
  { id: 'c4', number: 4, stageId: 's4', stageName: 'Ground floor slab', title: 'Slab, part 2 of 2', amount: 2_400_000, status: 'approved', requestedAt: ago(9), approvedAt: ago(6), requestedBy: 'Ubaka Builders', note: 'Concrete pour and curing.', lineItems: [{ label: 'Ready-mix concrete', amount: 1_900_000 }, { label: 'Labour', amount: 500_000 }], photos: [photo('p41', 18, 'Slab pour', 1)] },
  { id: 'c5', number: 5, stageId: 's5', stageName: 'First floor walls', title: 'First floor walls', amount: 3_000_000, status: 'submitted', requestedAt: ago(3, 2), requestedBy: 'Ubaka Builders', note: 'All first floor walls built to lintel and ring beam level. Photos from every side attached.', lineItems: [{ label: 'Labour', amount: 1_100_000 }, { label: 'Blocks and mortar', amount: 1_500_000 }, { label: 'Lintels', amount: 400_000 }], photos: p5 },
];

const updates: SiteUpdateView[] = [
  { id: 'u1', stageId: 's6', stageName: 'Roof structure', author: 'Jean Habimana', authorRole: 'supervisor', createdAt: ago(0, 4), note: 'Trusses delivered. Lifting starts tomorrow morning.', status: 'reported', photos: [photo('p61', 0, 'Trusses on site', 2), photo('p62', 0, 'Delivery note', 4)] },
  { id: 'u2', stageId: 's6', stageName: 'Roof structure', author: 'Jean Habimana', authorRole: 'supervisor', createdAt: ago(1, 5), note: 'Ring beam cured. Waiting for timber delivery.', blockers: 'Timber delivery one day late', status: 'problem', photos: [photo('p63', 1, 'Ring beam', 3)] },
  { id: 'u3', stageId: 's5', stageName: 'First floor walls', author: 'Eric Mugisha', authorRole: 'contractor', createdAt: ago(2, 1), note: 'First floor walls finished. Ready for your review.', status: 'reported', photos: p5 },
  { id: 'u4', stageId: 's5', stageName: 'First floor walls', author: 'Jean Habimana', authorRole: 'supervisor', createdAt: ago(4, 6), note: 'Lintels cast over windows and doors.', status: 'reported', photos: [photo('p64', 4, 'Lintel formwork', 5), photo('p65', 4, 'Window opening', 0)] },
  { id: 'u5', stageId: 's4', stageName: 'Ground floor slab', author: 'Eric Mugisha', authorRole: 'contractor', createdAt: ago(9, 2), note: 'Slab curing complete; 7-day log attached.', status: 'accepted', photos: [photo('p66', 9, 'Slab surface', 1)] },
  { id: 'u6', stageId: 's4', stageName: 'Ground floor slab', author: 'Jean Habimana', authorRole: 'supervisor', createdAt: ago(18, 3), note: 'Concrete poured in one day, no cold joints.', status: 'accepted', photos: [photo('p67', 18, 'Pour in progress', 2), photo('p68', 18, 'Vibrating concrete', 3)] },
];

export const demoProject: ProjectView = {
  id: 'prj-kicukiro',
  name: 'Kicukiro House',
  location: 'Kigali · Kicukiro · Niboye',
  contractValue: 24_000_000,
  updatedAt: ago(0, 2),
  stages,
  claims,
  updates,
  payments: [
    { id: 'pay1', claimNumber: 1, amount: 3_600_000, method: 'bank', recordedAt: ago(52), status: 'settled' },
    { id: 'pay2', claimNumber: 2, amount: 3_600_000, method: 'momo', recordedAt: ago(30), status: 'settled' },
    { id: 'pay3', claimNumber: 3, amount: 2_400_000, method: 'bank', recordedAt: ago(16), status: 'settled' },
  ],
  decisions: [
    { id: 'd1', kind: 'claim', title: 'Payment claim #5', subtitle: 'First floor walls', amount: 3_000_000, waitingSince: ago(3, 2), href: '/claim/c5' },
    { id: 'd2', kind: 'stage_review', title: 'Accept stage', subtitle: 'First floor walls · ready for review', waitingSince: ago(2, 1), href: '/stage/s5' },
  ],
  float: { custodian: 'Jean Habimana', expected: 420_000, counted: 405_000, lastCountAt: ago(1, 2) },
  team: [
    { name: 'Aline Uwase', role: 'owner', detail: 'Owner · lives in Brussels' },
    { name: 'Eric Mugisha', role: 'contractor', detail: 'Ubaka Builders Ltd' },
    { name: 'Jean Habimana', role: 'supervisor', detail: 'Site supervisor · holds site float' },
  ],
};

/** Derived figures the screens show. Computed, so they can never disagree with the rows. */
export function projectFigures(p: ProjectView) {
  const sumWeight = (pred: (s: StageView) => boolean) =>
    p.stages.filter(pred).reduce((n, s) => n + s.weight, 0);
  const sumClaims = (status: DemoClaimView['status']) =>
    p.claims.filter((c) => c.status === status).reduce((n, c) => n + c.amount, 0);
  const paid = sumClaims('paid');
  const approvedUnpaid = sumClaims('approved');
  return {
    acceptedPct: sumWeight((s) => s.status === 'accepted'),
    reportedPct: sumWeight((s) => s.status === 'ready_for_review'),
    paid,
    approvedUnpaid,
    awaitingDecision: sumClaims('submitted'),
    remaining: p.contractValue - paid - approvedUnpaid,
    stagesAccepted: p.stages.filter((s) => s.status === 'accepted').length,
  };
}
