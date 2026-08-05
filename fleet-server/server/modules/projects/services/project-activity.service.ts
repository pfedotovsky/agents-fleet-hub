import path from 'node:path';

import { AppError, normalizeProjectPath } from '@/shared/utils.js';

export type ProjectActivityKind = 'chat' | 'terminal' | 'clone' | 'file' | 'deletion';

type ProjectActivity = {
  id: number;
  kind: ProjectActivityKind;
  projectPath: string;
};

const activities = new Map<number, ProjectActivity>();
let nextActivityId = 1;

function canonicalComparisonPath(projectPath: string): string {
  return normalizeProjectPath(path.resolve(projectPath));
}

function pathsOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  return left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

function conflictingActivities(projectPath: string, kind: ProjectActivityKind): ProjectActivity[] {
  return Array.from(activities.values()).filter((activity) => {
    if (!pathsOverlap(projectPath, activity.projectPath)) return false;
    return kind === 'deletion' || activity.kind === 'deletion';
  });
}

/**
 * Coordinates project-scoped filesystem users with permanent deletion.
 * Normal operations may overlap each other, but deletion is exclusive across
 * the target tree and its ancestors so a new operation cannot race the final
 * safety check.
 */
export const projectActivityRegistry = {
  begin(kind: ProjectActivityKind, projectPath: string): () => void {
    const normalizedPath = canonicalComparisonPath(projectPath);
    const conflicts = conflictingActivities(normalizedPath, kind);
    if (conflicts.length > 0) {
      const activeKinds = Array.from(new Set(conflicts.map((activity) => activity.kind))).sort();
      throw new AppError('Project has active operations', {
        code: 'PROJECT_BUSY',
        statusCode: 409,
        details: { activeOperations: activeKinds },
      });
    }

    const id = nextActivityId++;
    activities.set(id, { id, kind, projectPath: normalizedPath });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activities.delete(id);
    };
  },

  listForPath(projectPath: string): ProjectActivityKind[] {
    const normalizedPath = canonicalComparisonPath(projectPath);
    return Array.from(
      new Set(
        Array.from(activities.values())
          .filter((activity) => pathsOverlap(normalizedPath, activity.projectPath))
          .map((activity) => activity.kind),
      ),
    ).sort();
  },

  clearAll(): void {
    activities.clear();
  },
};
