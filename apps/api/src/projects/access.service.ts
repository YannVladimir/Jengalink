import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ProjectRole } from '@jengalink/contracts';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database, Tx } from '../db/client';
import { DB } from '../db/database.module';
import {
  organizationMemberships,
  projectMemberships,
  projects,
} from '../db/schema';

export interface ProjectAccess {
  project: typeof projects.$inferSelect;
  roles: ProjectRole[];
  financialVisibility: boolean;
}

/** Roles that work with the money by their nature: the contractor side and finance. */
const MONEY_ROLES: readonly ProjectRole[] = [
  'contractor',
  'manager',
  'finance',
];

/**
 * Who may see a project's money (spec §5.1, §12): the owner, anyone given financial visibility,
 * and the money roles. Everyone else (site supervisor, viewer, inspector…) sees no amounts.
 */
export const seesMoney = (
  roles: readonly ProjectRole[],
  financialVisibility: boolean,
) => financialVisibility || roles.some((r) => MONEY_ROLES.includes(r));

/**
 * Server-side permission checks (spec §3.3). Never trusts a role or project id
 * from the client: access comes only from active, unexpired memberships.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Returns the caller's access to a project.
   * No membership → 404 (the project's existence is not revealed).
   * Membership but none of `allowed` → 403.
   */
  async requireProject(
    userId: string,
    projectId: string,
    allowed?: readonly ProjectRole[],
    tx: Tx | Database = this.db,
  ): Promise<ProjectAccess> {
    const rows = await tx
      .select({
        project: projects,
        role: projectMemberships.role,
        finance: projectMemberships.financialVisibility,
      })
      .from(projectMemberships)
      .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
      .where(
        and(
          eq(projectMemberships.projectId, projectId),
          eq(projectMemberships.userId, userId),
          eq(projectMemberships.status, 'active'),
          or(
            isNull(projectMemberships.expiresAt),
            gt(projectMemberships.expiresAt, new Date()),
          ),
        ),
      );
    if (rows.length === 0) throw new NotFoundException('Project not found');
    const roles = rows.map((r) => r.role);
    if (allowed && !roles.some((r) => allowed.includes(r))) {
      throw new ForbiddenException(
        'Your role on this project does not allow this',
      );
    }
    return {
      project: rows[0].project,
      roles,
      financialVisibility: rows.some((r) => r.finance || r.role === 'owner'),
    };
  }

  /** Active organization membership, or 404. */
  async requireOrganization(
    userId: string,
    organizationId: string,
    adminOnly = false,
  ) {
    const [m] = await this.db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active'),
        ),
      );
    if (!m) throw new NotFoundException('Organization not found');
    if (adminOnly && m.role !== 'admin') {
      throw new ForbiddenException('Only organization admins can do this');
    }
    return m;
  }
}
