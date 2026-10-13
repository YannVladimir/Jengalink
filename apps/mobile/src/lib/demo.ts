// Demo data access. Swapped for API calls once the endpoints exist.
import { demoProject, projectFigures } from '@jengalink/contracts/demo';

export const project = demoProject;
export const figures = projectFigures(demoProject);

export const findClaim = (id: string) => project.claims.find((c) => c.id === id);
export const findStage = (id: string) => project.stages.find((s) => s.id === id);

/** Days between planned and current end; positive = late. */
export const delayDays = (plannedEnd: string, currentEnd: string) =>
  Math.round((new Date(currentEnd).getTime() - new Date(plannedEnd).getTime()) / 86_400_000);
