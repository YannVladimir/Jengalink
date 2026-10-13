// Organizations, projects, memberships and invitations (spec §3, §19.2).
import { z } from 'zod';
import { OtpChannel } from './auth';
import { ProjectType, StageDrafts } from './planning';
import type { Role } from './views';

export const OrganizationKind = z.enum(['household', 'contractor', 'developer', 'supplier', 'inspection']);
export type OrganizationKind = z.infer<typeof OrganizationKind>;
export const OrganizationRole = z.enum(['admin', 'member']);
export type OrganizationRole = z.infer<typeof OrganizationRole>;
export const ProjectRole = z.enum([
  'owner',
  'delegate',
  'manager',
  'contractor',
  'supervisor',
  'finance',
  'inspector',
  'supplier',
  'viewer',
]);
export type ProjectRole = z.infer<typeof ProjectRole>;
export const ProjectStatus = z.enum(['draft', 'active', 'handover', 'archived', 'paused', 'cancelled']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/** POST /v1/organizations */
export const CreateOrganizationRequest = z
  .object({ name: z.string().trim().min(2).max(120), kind: OrganizationKind })
  .meta({ id: 'CreateOrganizationRequest' });
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequest>;

export const OrganizationView = z
  .object({ id: z.uuid(), name: z.string(), kind: OrganizationKind, myRole: OrganizationRole })
  .meta({ id: 'OrganizationView' });
export type OrganizationView = z.infer<typeof OrganizationView>;

export const ProjectLocation = z
  .object({
    province: z.string().max(60).optional(),
    district: z.string().max(60).optional(),
    sector: z.string().max(60).optional(),
    cell: z.string().max(60).optional(),
    village: z.string().max(60).optional(),
  })
  .meta({ id: 'ProjectLocation' });
export type ProjectLocation = z.infer<typeof ProjectLocation>;

/** POST /v1/projects */
export const CreateProjectRequest = z
  .object({
    organizationId: z.uuid(),
    name: z.string().trim().min(2).max(120),
    type: ProjectType.default('house'),
    location: ProjectLocation.optional(),
    /** Agreed contract value in whole RWF; the owner accepts it later. */
    contractValue: z.number().int().min(0).max(1_000_000_000_000).optional(),
    /** Starting stages (usually from a template); weights total 100. */
    stages: StageDrafts.optional(),
  })
  .meta({ id: 'CreateProjectRequest' });
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const ProjectSummary = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string(),
    name: z.string(),
    type: ProjectType,
    status: ProjectStatus,
    currency: z.string(),
    /** Null for people who may not see the money (see seesMoney). */
    contractValue: z.number().int().nullable(),
    /** The caller may see this project's money: show money cards, quotes and amounts. */
    seesMoney: z.boolean(),
    stageCount: z.number().int(),
    location: ProjectLocation,
    myRoles: z.array(ProjectRole),
    /** False until an owner has accepted; approvals cannot be activated before (spec §3.1). */
    hasOwner: z.boolean(),
    /** Send as If-Match for transitions such as activate. */
    revision: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ProjectSummary' });
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const MemberView = z
  .object({
    membershipId: z.uuid(),
    userId: z.uuid(),
    displayName: z.string().nullable(),
    /** Masked contact, e.g. "+250 78* *** 456". */
    contact: z.string().nullable(),
    role: ProjectRole,
    financialVisibility: z.boolean(),
    joinedAt: z.iso.datetime(),
  })
  .meta({ id: 'MemberView' });
export type MemberView = z.infer<typeof MemberView>;

/** POST /v1/projects/:id/invitations and POST /v1/organizations/:id/invitations (need Idempotency-Key) */
export const CreateInvitationRequest = z
  .object({
    channel: OtpChannel,
    /** Rwandan mobile (sms) or email address. */
    recipient: z.string().min(3).max(254),
    /** A project role, or admin/member for an organization. */
    role: z.union([ProjectRole, OrganizationRole]),
    financialVisibility: z.boolean().optional(),
  })
  .meta({ id: 'CreateInvitationRequest' });
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

export const InvitationState = z.enum(['pending', 'accepted', 'declined', 'revoked', 'expired']);
export type InvitationState = z.infer<typeof InvitationState>;

/** What a project invitation's recipient sees before accepting (spec §37.3: benefits and permissions in plain words). */
export const InvitationProjectPreview = z
  .object({
    type: ProjectType,
    status: ProjectStatus,
    currency: z.string(),
    contractValue: z.number().int().nullable(),
    stageCount: z.number().int(),
    province: z.string().nullable(),
    district: z.string().nullable(),
  })
  .meta({ id: 'InvitationProjectPreview' });
export type InvitationProjectPreview = z.infer<typeof InvitationProjectPreview>;

export const InvitationView = z
  .object({
    id: z.uuid(),
    scope: z.enum(['organization', 'project']),
    organizationName: z.string(),
    organizationKind: OrganizationKind,
    projectId: z.uuid().nullable(),
    projectName: z.string().nullable(),
    /** Project invitations only. */
    project: InvitationProjectPreview.nullable(),
    role: z.string(),
    /** Whether the role will see the project's money records. */
    financialVisibility: z.boolean(),
    invitedBy: z.string().nullable(),
    /** Masked recipient. */
    sentTo: z.string(),
    state: InvitationState,
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'InvitationView' });
export type InvitationView = z.infer<typeof InvitationView>;

/** Returned to the inviter only: the link they can share on WhatsApp. */
export const CreatedInvitation = InvitationView.extend({ link: z.url() }).meta({ id: 'CreatedInvitation' });
export type CreatedInvitation = z.infer<typeof CreatedInvitation>;

/** The demo-role vocabulary of the apps maps onto project roles. */
export const appRoleFor = (roles: ProjectRole[]): Role =>
  roles.includes('owner') ? 'owner' : roles.includes('supervisor') ? 'supervisor' : 'contractor';
