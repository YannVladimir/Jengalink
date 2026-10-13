import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateOrganizationRequest,
  CreateProjectRequest,
  MemberView,
  OrganizationView,
  ProjectRole,
  ProjectStage,
  ProjectSummary,
  AcceptanceRecord,
  ProjectAcceptanceView,
  StagePlan,
} from '@jengalink/contracts';
import {
  AcceptanceDecisionRequest,
  SaveStagePlanRequest,
} from '@jengalink/contracts';
import { alias } from 'drizzle-orm/pg-core';
import { recordEvent } from '../jobs/outbox';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { maskEmail, maskPhone } from '../auth/contact';
import type { Database } from '../db/client';
import { AuditService } from '../audit/audit.service';
import {
  parseIfMatch,
  PreconditionRequiredException,
  VersionConflictException,
} from '../common/versioning';
import { ZodPipe } from '../common/zod.pipe';
import { DB } from '../db/database.module';
import {
  organizationMemberships,
  organizations,
  projectAcceptances,
  projectMemberships,
  projects,
  stages,
  users,
} from '../db/schema';
import { LocationsService } from '../locations/locations.service';
import { AccessService, seesMoney } from './access.service';
import { INVITABLE } from './invitations.service';

/** Roles that may change the stage plan while the project is a draft. */
const PLANNERS: readonly ProjectRole[] = ['owner', 'manager', 'contractor'];
const savePlanPipe = new ZodPipe(SaveStagePlanRequest);
const decisionPipe = new ZodPipe(AcceptanceDecisionRequest);

/** Active and not expired, evaluated at query time. */
const activeMembership = () =>
  and(
    eq(projectMemberships.status, 'active'),
    or(
      isNull(projectMemberships.expiresAt),
      gt(projectMemberships.expiresAt, new Date()),
    ),
  );

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly locations: LocationsService,
  ) {}

  /* ---------- organizations ---------- */

  /** Creates a workspace; the creator becomes its admin. */
  async createOrganization(
    userId: string,
    req: CreateOrganizationRequest,
  ): Promise<OrganizationView> {
    return this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ ...req, createdBy: userId })
        .returning();
      await tx.insert(organizationMemberships).values({
        organizationId: org.id,
        userId,
        role: 'admin',
        createdBy: userId,
      });
      await this.audit.record(tx, {
        action: 'organization.created',
        actor: { userId },
        organizationId: org.id,
        target: { type: 'organization', id: org.id },
        metadata: { kind: org.kind },
      });
      return { id: org.id, name: org.name, kind: org.kind, myRole: 'admin' };
    });
  }

  async listOrganizations(userId: string): Promise<OrganizationView[]> {
    const rows = await this.db
      .select({ org: organizations, role: organizationMemberships.role })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMemberships.organizationId),
      )
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active'),
        ),
      )
      .orderBy(asc(organizations.name));
    return rows.map((r) => ({
      id: r.org.id,
      name: r.org.name,
      kind: r.org.kind,
      myRole: r.role,
    }));
  }

  /* ---------- projects ---------- */

  /**
   * Any member of the managing organization may create a project. In a
   * household workspace the creator is the owner; otherwise the creator is the
   * contractor and must invite the owner before activation (spec §3.1).
   */
  async createProject(
    userId: string,
    req: CreateProjectRequest,
  ): Promise<ProjectSummary> {
    await this.access.requireOrganization(userId, req.organizationId);
    // Official spelling, levels in order; a draft may stop before the village.
    const location = this.locations.canonical(req.location ?? {});
    const id = await this.db.transaction(async (tx) => {
      const [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, req.organizationId));
      const creatorRole: ProjectRole =
        org.kind === 'household' ? 'owner' : 'contractor';
      const [p] = await tx
        .insert(projects)
        .values({
          organizationId: req.organizationId,
          name: req.name,
          type: req.type,
          location,
          contractValue: req.contractValue ?? null,
          ownerUserId: creatorRole === 'owner' ? userId : null,
          createdBy: userId,
        })
        .returning({ id: projects.id });
      await tx.insert(projectMemberships).values({
        organizationId: req.organizationId,
        projectId: p.id,
        userId,
        role: creatorRole,
        financialVisibility: true,
        createdBy: userId,
      });
      if (req.stages?.length) {
        await tx.insert(stages).values(
          req.stages.map((st, i) => ({
            organizationId: req.organizationId,
            projectId: p.id,
            name: st.name,
            weight: st.weight,
            position: i + 1,
            createdBy: userId,
          })),
        );
      }
      await this.audit.record(tx, {
        action: 'project.created',
        actor: { userId },
        organizationId: req.organizationId,
        projectId: p.id,
        target: { type: 'project', id: p.id },
        metadata: {
          creatorRole,
          type: req.type,
          stages: req.stages?.length ?? 0,
        },
      });
      return p.id;
    });
    return this.getProject(userId, id);
  }

  /** Only projects the caller is an active member of; nothing else is discoverable. */
  async listProjects(userId: string): Promise<ProjectSummary[]> {
    const rows = await this.db
      .select({
        project: projects,
        orgName: organizations.name,
        role: projectMemberships.role,
        finance: projectMemberships.financialVisibility,
      })
      .from(projectMemberships)
      .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
      .innerJoin(organizations, eq(organizations.id, projects.organizationId))
      .where(and(eq(projectMemberships.userId, userId), activeMembership()))
      .orderBy(desc(projects.createdAt));
    const byId = new Map<
      string,
      {
        project: typeof projects.$inferSelect;
        orgName: string;
        roles: ProjectRole[];
        finance: boolean;
      }
    >();
    for (const r of rows) {
      const entry = byId.get(r.project.id) ?? {
        project: r.project,
        orgName: r.orgName,
        roles: [],
        finance: false,
      };
      entry.roles.push(r.role);
      entry.finance ||= r.finance || r.role === 'owner';
      byId.set(r.project.id, entry);
    }
    return Promise.all(
      [...byId.values()].map(async (e) =>
        this.summary(
          e.project,
          e.orgName,
          e.roles,
          seesMoney(e.roles, e.finance),
        ),
      ),
    );
  }

  async getProject(userId: string, projectId: string): Promise<ProjectSummary> {
    const { project, roles, financialVisibility } =
      await this.access.requireProject(userId, projectId);
    const [org] = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, project.organizationId));
    return this.summary(
      project,
      org.name,
      roles,
      seesMoney(roles, financialVisibility),
    );
  }

  /** Draft → Active, only once an owner has accepted (spec §3.1, §18). */
  /* ---------- stages ---------- */

  async listStages(userId: string, projectId: string): Promise<ProjectStage[]> {
    await this.access.requireProject(userId, projectId);
    return this.stagesOf(projectId);
  }

  /** The stage plan with what the caller may do (spec §5.2). */
  async getPlan(userId: string, projectId: string): Promise<StagePlan> {
    const { project, roles, financialVisibility } =
      await this.access.requireProject(userId, projectId);
    return {
      projectId,
      revision: project.revision,
      canEdit: roles.some((r) => PLANNERS.includes(r)),
      locked: project.status !== 'draft',
      currency: project.currency,
      contractValue: seesMoney(roles, financialVisibility)
        ? project.contractValue
        : null,
      stages: await this.stagesOf(projectId),
      latestDecision:
        (
          await this.decisions(
            projectId,
            1,
            seesMoney(roles, financialVisibility),
          )
        )[0] ?? null,
    };
  }

  /**
   * Replaces the whole plan in one step, so weights always total 100.
   * Draft projects only: once started, changes need a change request (spec §13.3).
   * If-Match carries the project revision; every save raises it.
   */
  async savePlan(
    userId: string,
    projectId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<StagePlan> {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.some((r) => PLANNERS.includes(r)))
      throw new ForbiddenException(
        'Only the owner, manager or contractor can change the plan',
      );
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    if (project.status !== 'draft')
      throw new ConflictException(
        'The plan is locked because the project has started. Changes go through a change request.',
      );
    if (project.revision !== expected)
      throw new VersionConflictException(project.revision);
    const req = savePlanPipe.transform(body);

    await this.db.transaction(async (tx) => {
      const bumped = await tx
        .update(projects)
        .set({
          updatedAt: new Date(),
          revision: sql`${projects.revision} + 1`,
          ...(req.contractValue !== undefined
            ? { contractValue: req.contractValue }
            : {}),
        })
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.status, 'draft'),
            eq(projects.revision, expected),
          ),
        )
        .returning({ id: projects.id });
      if (bumped.length === 0) throw new VersionConflictException();

      const existing = await tx
        .select({ id: stages.id })
        .from(stages)
        .where(eq(stages.projectId, projectId));
      const known = new Set(existing.map((e) => e.id));
      const fieldErrors = req.stages.flatMap((st, i) =>
        st.id && !known.has(st.id)
          ? [
              {
                field: 'stages.' + i + '.id',
                message: 'Not a stage of this project',
              },
            ]
          : [],
      );
      if (fieldErrors.length)
        throw new BadRequestException({
          message: 'Unknown stage',
          fieldErrors,
        });

      const kept = new Set(req.stages.flatMap((st) => (st.id ? [st.id] : [])));
      const removed = [...known].filter((id) => !kept.has(id));
      if (removed.length)
        await tx.delete(stages).where(inArray(stages.id, removed));

      let added = 0;
      for (const [i, st] of req.stages.entries()) {
        const values = {
          name: st.name,
          weight: st.weight,
          position: i + 1,
          description: st.description || null,
          plannedStart: st.plannedStart ?? null,
          plannedEnd: st.plannedEnd ?? null,
          criteria: st.criteria ?? [],
        };
        if (st.id) {
          await tx
            .update(stages)
            .set({
              ...values,
              updatedAt: new Date(),
              revision: sql`${stages.revision} + 1`,
            })
            .where(and(eq(stages.id, st.id), eq(stages.projectId, projectId)));
        } else {
          added++;
          await tx.insert(stages).values({
            ...values,
            organizationId: project.organizationId,
            projectId,
            createdBy: userId,
          });
        }
      }
      await this.audit.record(tx, {
        action: 'stage_plan.saved',
        actor: { userId },
        organizationId: project.organizationId,
        projectId,
        target: { type: 'project', id: projectId },
        metadata: {
          stages: req.stages.length,
          added,
          removed: removed.length,
          withDates: req.stages.filter((st) => st.plannedStart && st.plannedEnd)
            .length,
          withCriteria: req.stages.filter((st) => st.criteria?.length).length,
          ...(req.contractValue !== undefined &&
          req.contractValue !== project.contractValue
            ? { contractValueChanged: true }
            : {}),
        },
      });
    });
    return this.getPlan(userId, projectId);
  }

  /* ---------- owner acceptance of the baseline ---------- */

  /** Everything the owner reviews: value, stages with dates and checks, and past decisions. */
  async getAcceptance(
    userId: string,
    projectId: string,
  ): Promise<ProjectAcceptanceView> {
    const { project, roles, financialVisibility } =
      await this.access.requireProject(userId, projectId);
    const [org] = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, project.organizationId));
    const stageList = await this.stagesOf(projectId);
    const readiness = {
      stages: stageList.length > 0,
      contractValue: project.contractValue !== null,
    };
    return {
      projectId,
      projectName: project.name,
      organizationName: org?.name ?? '',
      status: project.status,
      revision: project.revision,
      currency: project.currency,
      contractValue: seesMoney(roles, financialVisibility)
        ? project.contractValue
        : null,
      stages: stageList,
      canDecide: roles.includes('owner') && project.status === 'draft',
      readiness,
      ready: readiness.stages && readiness.contractValue,
      history: await this.decisions(
        projectId,
        20,
        seesMoney(roles, financialVisibility),
      ),
    };
  }

  /**
   * The owner accepts the exact revision they reviewed (Draft → Active, plan locked)
   * or asks for changes with a note (stays Draft). If-Match = project revision.
   */
  async decide(
    userId: string,
    projectId: string,
    ifMatch: string | undefined,
    body: unknown,
  ): Promise<ProjectAcceptanceView> {
    const { project, roles } = await this.access.requireProject(
      userId,
      projectId,
    );
    if (!roles.includes('owner'))
      throw new ForbiddenException(
        'Only the owner can accept the project or ask for changes',
      );
    const expected = parseIfMatch(ifMatch);
    if (expected === null) throw new PreconditionRequiredException();
    if (project.status !== 'draft')
      throw new ConflictException(`The project is already ${project.status}`);
    if (project.revision !== expected)
      throw new VersionConflictException(project.revision);
    const req = decisionPipe.transform(body);
    const stageList = await this.stagesOf(projectId);
    if (req.decision === 'accept') {
      const missing = [
        ...(stageList.length ? [] : ['stages']),
        ...(project.contractValue === null ? ['contractValue'] : []),
      ];
      if (missing.length)
        throw new ConflictException({
          message:
            'The project is not ready to accept: it needs at least one stage and an agreed contract value.',
          fieldErrors: missing.map((field) => ({ field, message: 'Missing' })),
        });
    }

    const accepted = req.decision === 'accept';
    await this.db.transaction(async (tx) => {
      // Compare-and-set on the reviewed revision: a plan edited meanwhile cannot be accepted by mistake.
      const touched = await tx
        .update(projects)
        .set(
          accepted
            ? {
                status: 'active',
                updatedAt: new Date(),
                revision: sql`${projects.revision} + 1`,
              }
            : { updatedAt: new Date() },
        )
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.status, 'draft'),
            eq(projects.revision, expected),
          ),
        )
        .returning({ id: projects.id });
      if (touched.length === 0) throw new VersionConflictException();
      const [row] = await tx
        .insert(projectAcceptances)
        .values({
          organizationId: project.organizationId,
          projectId,
          decision: accepted ? 'accepted' : 'changes_requested',
          note: req.note || null,
          projectRevision: expected,
          contractValue: project.contractValue,
          currency: project.currency,
          stages: stageList.map((st) => ({
            id: st.id,
            name: st.name,
            weight: st.weight,
            plannedStart: st.plannedStart,
            plannedEnd: st.plannedEnd,
            criteria: st.criteria,
          })),
          decidedBy: userId,
        })
        .returning({ id: projectAcceptances.id });
      await this.audit.record(tx, {
        action: accepted ? 'project.accepted' : 'project.changes_requested',
        actor: { userId },
        organizationId: project.organizationId,
        projectId,
        target: { type: 'project', id: projectId },
        metadata: {
          revision: expected,
          contractValue: project.contractValue,
          stages: stageList.length,
        },
      });
      await recordEvent(
        tx,
        'project.decided',
        {
          acceptanceId: row.id,
          projectId,
          decision: accepted ? 'accepted' : 'changes_requested',
        },
        userId,
      );
    });
    return this.getAcceptance(userId, projectId);
  }

  private async decisions(
    projectId: string,
    limit: number,
    withMoney: boolean,
  ): Promise<AcceptanceRecord[]> {
    const decider = alias(users, 'decider');
    const rows = await this.db
      .select({ a: projectAcceptances, name: decider.displayName })
      .from(projectAcceptances)
      .leftJoin(decider, eq(decider.id, projectAcceptances.decidedBy))
      .where(eq(projectAcceptances.projectId, projectId))
      .orderBy(desc(projectAcceptances.createdAt))
      .limit(limit);
    return rows.map(({ a, name }) => ({
      id: a.id,
      decision: a.decision,
      note: a.note,
      decidedByName: name,
      decidedAt: a.createdAt.toISOString(),
      projectRevision: a.projectRevision,
      contractValue: withMoney ? a.contractValue : null,
      currency: a.currency,
      stageCount: a.stages.length,
    }));
  }

  private async stagesOf(projectId: string): Promise<ProjectStage[]> {
    const rows = await this.db
      .select()
      .from(stages)
      .where(eq(stages.projectId, projectId))
      .orderBy(asc(stages.position));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      weight: r.weight,
      status: r.status,
      description: r.description,
      plannedStart: r.plannedStart,
      plannedEnd: r.plannedEnd,
      criteria: r.criteria,
    }));
  }

  /* ---------- members ---------- */

  async listMembers(userId: string, projectId: string): Promise<MemberView[]> {
    await this.access.requireProject(userId, projectId);
    const rows = await this.db
      .select({ m: projectMemberships, u: users })
      .from(projectMemberships)
      .innerJoin(users, eq(users.id, projectMemberships.userId))
      .where(
        and(eq(projectMemberships.projectId, projectId), activeMembership()),
      )
      .orderBy(asc(projectMemberships.createdAt));
    return rows.map(({ m, u }) => ({
      membershipId: m.id,
      userId: u.id,
      displayName: u.displayName,
      contact: u.verifiedPhone
        ? maskPhone(u.verifiedPhone)
        : u.verifiedEmail
          ? maskEmail(u.verifiedEmail)
          : null,
      role: m.role,
      financialVisibility: m.financialVisibility,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  /**
   * Revokes a membership. Takes effect on the member's very next request
   * (spec §3.3). Owners may remove anyone but the last owner; managers and
   * contractors only the roles they may invite.
   */
  async removeMember(
    userId: string,
    projectId: string,
    membershipId: string,
  ): Promise<void> {
    const { roles } = await this.access.requireProject(userId, projectId);
    await this.db.transaction(async (tx) => {
      const [m] = await tx
        .select()
        .from(projectMemberships)
        .where(
          and(
            eq(projectMemberships.id, membershipId),
            eq(projectMemberships.projectId, projectId),
            eq(projectMemberships.status, 'active'),
          ),
        )
        .for('update');
      if (!m) throw new NotFoundException('Member not found');

      const allowed = new Set(
        roles.flatMap((r) =>
          r === 'owner'
            ? (INVITABLE.owner ?? [])
            : (INVITABLE[r] ?? []).filter((x) => x !== 'owner'),
        ),
      );
      if (!allowed.has(m.role))
        throw new ForbiddenException('Your role cannot remove this member');

      if (m.role === 'owner') {
        const owners = await tx
          .select({ id: projectMemberships.id })
          .from(projectMemberships)
          .where(
            and(
              eq(projectMemberships.projectId, projectId),
              eq(projectMemberships.role, 'owner'),
              eq(projectMemberships.status, 'active'),
            ),
          )
          .for('update');
        if (owners.length <= 1)
          throw new ConflictException('A project needs at least one owner');
      }
      await tx
        .update(projectMemberships)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revokedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(projectMemberships.id, m.id));
      await this.audit.record(tx, {
        action: 'member.removed',
        actor: { userId },
        organizationId: m.organizationId,
        projectId,
        target: { type: 'project_membership', id: m.id },
        metadata: { role: m.role, removedUserId: m.userId },
      });
    });
  }

  /* ---------- helpers ---------- */

  private async stageCount(projectId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: count() })
      .from(stages)
      .where(eq(stages.projectId, projectId));
    return r.n;
  }

  private async hasOwner(projectId: string): Promise<boolean> {
    const [o] = await this.db
      .select({ id: projectMemberships.id })
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.projectId, projectId),
          eq(projectMemberships.role, 'owner'),
          activeMembership(),
        ),
      );
    return !!o;
  }

  private async summary(
    p: typeof projects.$inferSelect,
    orgName: string,
    roles: ProjectRole[],
    withMoney: boolean,
  ): Promise<ProjectSummary> {
    return {
      id: p.id,
      organizationId: p.organizationId,
      organizationName: orgName,
      name: p.name,
      type: p.type,
      status: p.status,
      currency: p.currency,
      contractValue: withMoney ? p.contractValue : null,
      seesMoney: withMoney,
      stageCount: await this.stageCount(p.id),
      location: p.location,
      myRoles: roles,
      hasOwner: roles.includes('owner') || (await this.hasOwner(p.id)),
      revision: p.revision,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
