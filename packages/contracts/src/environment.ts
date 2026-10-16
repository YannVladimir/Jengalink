// The environment the apps talk to (spec §34: a Demo environment banner must remain visible).
import { z } from 'zod';
import type { ProjectRole } from './access';

/** GET /v1/environment (public): what the apps need to know before anyone signs in. */
export const EnvironmentInfo = z
  .object({
    /** Made-up data only: the apps show a Demo banner on every screen and offer the demo people. */
    demo: z.boolean(),
  })
  .meta({ id: 'EnvironmentInfo' });
export type EnvironmentInfo = z.infer<typeof EnvironmentInfo>;

/** In a demo environment, every demo person signs in with this code (no SMS is sent). */
export const DEMO_CODE = '000000';

export interface DemoPerson {
  key: string;
  name: string;
  /** Local format, as typed on the sign-in screen. Numbers sit in a block reserved for demos. */
  phone: string;
  role: ProjectRole;
  /** The project they belong to; people on one project cannot see the other (the contractor builds both). */
  project: 'house' | 'renovation' | 'both';
}

/** Fictional people: no real identity or phone number (spec §34). */
export const DEMO_PEOPLE: readonly DemoPerson[] = [
  { key: 'owner', name: 'Aline Uwase', phone: '0788000101', role: 'owner', project: 'house' },
  { key: 'contractor', name: 'Eric Mugisha', phone: '0788000102', role: 'contractor', project: 'both' },
  { key: 'supervisor', name: 'Jean Habimana', phone: '0788000103', role: 'supervisor', project: 'house' },
  { key: 'supervisor2', name: 'Claudine Ingabire', phone: '0788000104', role: 'supervisor', project: 'renovation' },
  { key: 'finance', name: 'Grace Mukamana', phone: '0788000105', role: 'finance', project: 'house' },
  { key: 'supplier', name: 'Patrick Nshimiyimana', phone: '0788000106', role: 'supplier', project: 'house' },
  { key: 'inspector', name: 'Diane Uwimana', phone: '0788000107', role: 'inspector', project: 'house' },
  { key: 'owner2', name: 'Samuel Kayitare', phone: '0788000108', role: 'owner', project: 'renovation' },
];

/** +250788000101 → the demo person, if it is one. */
export const demoPersonFor = (e164: string) => DEMO_PEOPLE.find((p) => `+250${p.phone.slice(1)}` === e164);
