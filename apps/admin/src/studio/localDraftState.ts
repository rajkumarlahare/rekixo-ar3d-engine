import type { Project } from "./domain";

function time(value: string | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectAheadOfCloud(project: Project) {
  if (!project.cloud) return false;
  return time(project.updated) > time(project.cloud.syncedAt);
}

export function withLocalSaveTimestamp(project: Project, now = new Date()) {
  return {
    ...project,
    updated: now.toISOString(),
  };
}
