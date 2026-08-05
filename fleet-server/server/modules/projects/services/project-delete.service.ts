// Modified from CloudCLI 1.36.1 — see NOTICE.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { getConnection, getDatabasePath, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { projectActivityRegistry } from '@/modules/projects/services/project-activity.service.js';
import { AppError, normalizeProjectPath, WORKSPACES_ROOT } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);

type ProjectSessionRow = {
  provider: string;
  jsonl_path: string | null;
};

export type ProjectDeletionPreview = {
  canonicalPath: string;
  workspaceExists: boolean;
  sessionCount: number;
  fileCount: number;
  sizeBytes: number;
  activeOperations: string[];
  git: {
    repository: boolean;
    dirty: boolean | null;
    untracked: boolean | null;
    unpushed: boolean | null;
  };
};

function isPathInside(parentPath: string, candidatePath: string): boolean {
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${path.sep}`);
}

function isAncestorOf(ancestorPath: string, candidatePath: string): boolean {
  return candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath}${path.sep}`);
}

async function realpathIfExists(candidatePath: string): Promise<string | null> {
  try {
    return normalizeProjectPath(await fs.realpath(candidatePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function protectedRuntimePaths(): Promise<string[]> {
  const fleetServerHome = process.env.FLEET_SERVER_HOME || path.join(os.homedir(), '.fleet-server');
  const modulePath = fileURLToPath(import.meta.url);
  const paths = [
    os.homedir(),
    process.env.WORKSPACES_ROOT || WORKSPACES_ROOT,
    fleetServerHome,
    getDatabasePath(),
    process.execPath,
    process.cwd(),
    modulePath,
  ].map((candidate) => normalizeProjectPath(path.resolve(candidate)));
  return Promise.all(paths.map(async (candidate) => (await realpathIfExists(candidate)) ?? candidate));
}

async function resolveSafeProjectTarget(projectId: string): Promise<{
  row: NonNullable<ReturnType<typeof projectsDb.getProjectById>>;
  canonicalPath: string;
  workspaceExists: boolean;
}> {
  const row = projectsDb.getProjectById(projectId);
  if (!row) {
    throw new AppError(`Unknown projectId: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }
  if (!row.isArchived) {
    throw new AppError('Permanent deletion is available only for archived projects', {
      code: 'PROJECT_NOT_ARCHIVED',
      statusCode: 409,
    });
  }
  if (!path.isAbsolute(row.project_path)) {
    throw new AppError('Project path is not absolute', {
      code: 'UNSAFE_PROJECT_PATH',
      statusCode: 409,
    });
  }

  const storedPath = normalizeProjectPath(path.resolve(row.project_path));
  const filesystemRoot = normalizeProjectPath(path.parse(storedPath).root);
  if (!storedPath || storedPath === filesystemRoot) {
    throw new AppError('Filesystem roots cannot be deleted as projects', {
      code: 'PROTECTED_PROJECT_PATH',
      statusCode: 409,
    });
  }

  for (const protectedPath of await protectedRuntimePaths()) {
    if (isAncestorOf(storedPath, protectedPath)) {
      throw new AppError('Project path contains protected user or fleet-server state', {
        code: 'PROTECTED_PROJECT_PATH',
        statusCode: 409,
      });
    }
  }

  const configuredWorkspaceRoot = process.env.WORKSPACES_ROOT || WORKSPACES_ROOT;
  const workspaceRoot =
    (await realpathIfExists(path.resolve(configuredWorkspaceRoot)))
    ?? normalizeProjectPath(path.resolve(configuredWorkspaceRoot));
  if (storedPath === workspaceRoot || !isPathInside(workspaceRoot, storedPath)) {
    throw new AppError('Project path is outside the configured workspace root or is too broad', {
      code: 'UNSAFE_PROJECT_PATH',
      statusCode: 409,
    });
  }

  const otherProjects = [...projectsDb.getProjectPaths(), ...projectsDb.getArchivedProjectPaths()]
    .filter((project) => project.project_id !== projectId)
    .map((project) => normalizeProjectPath(path.resolve(project.project_path)));
  if (otherProjects.some((otherPath) => isAncestorOf(storedPath, otherPath))) {
    throw new AppError('Project path contains another registered project and is too broad to delete', {
      code: 'PROJECT_PATH_TOO_BROAD',
      statusCode: 409,
    });
  }

  let workspaceExists = true;
  try {
    const stats = await fs.lstat(storedPath);
    if (stats.isSymbolicLink()) {
      throw new AppError('A symlink cannot be used as a permanent-deletion root', {
        code: 'PROJECT_SYMLINK_ROOT',
        statusCode: 409,
      });
    }
    if (!stats.isDirectory()) {
      throw new AppError('Project path is not a directory', {
        code: 'UNSAFE_PROJECT_PATH',
        statusCode: 409,
      });
    }
    const realPath = normalizeProjectPath(await fs.realpath(storedPath));
    if (realPath !== storedPath) {
      throw new AppError('Project path does not match its canonical filesystem path', {
        code: 'PROJECT_PATH_NOT_CANONICAL',
        statusCode: 409,
        details: { canonicalPath: realPath },
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    workspaceExists = false;
  }

  return { row, canonicalPath: storedPath, workspaceExists };
}

async function measureTree(rootPath: string): Promise<{ fileCount: number; sizeBytes: number }> {
  let fileCount = 0;
  let sizeBytes = 0;
  const pending = [rootPath];

  while (pending.length > 0) {
    const directoryPath = pending.pop() as string;
    const directory = await fs.opendir(directoryPath);
    for await (const entry of directory) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      fileCount += 1;
      const stats = await fs.lstat(entryPath);
      sizeBytes += stats.size;
      // lstat + no recursion through non-directories means symlinks are counted
      // as links and never traversed beyond the workspace root.
    }
  }

  return { fileCount, sizeBytes };
}

async function gitRisk(projectPath: string): Promise<ProjectDeletionPreview['git']> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectPath, 'status', '--porcelain=v1', '--branch'],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
    );
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const changes = lines.filter((line) => !line.startsWith('## '));
    const dirty = changes.some((line) => !line.startsWith('?? '));
    const untracked = changes.some((line) => line.startsWith('?? '));
    const branch = lines.find((line) => line.startsWith('## ')) ?? '';
    let unpushed: boolean | null = branch.includes('[ahead ');

    if (!branch.includes('...')) {
      try {
        await execFileAsync('git', ['-C', projectPath, 'rev-parse', '--verify', 'HEAD'], {
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        });
        unpushed = true;
      } catch {
        unpushed = false;
      }
    }

    return { repository: true, dirty, untracked, unpushed };
  } catch {
    return { repository: false, dirty: null, untracked: null, unpushed: null };
  }
}

function allowedTranscriptRoots(projectPath: string): string[] {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return [
    projectPath,
    path.join(os.homedir(), '.claude', 'projects'),
    path.join(codexHome, 'sessions'),
    path.join(os.homedir(), '.cursor'),
    path.join(os.homedir(), '.config', 'opencode'),
    path.join(os.homedir(), '.local', 'share', 'opencode'),
  ].map((candidate) => normalizeProjectPath(path.resolve(candidate)));
}

async function validateTranscriptPath(
  transcriptPath: string,
  projectPath: string,
): Promise<string> {
  if (!path.isAbsolute(transcriptPath) || path.extname(transcriptPath).toLowerCase() !== '.jsonl') {
    throw new AppError('Refusing to delete an invalid transcript path', {
      code: 'UNSAFE_TRANSCRIPT_PATH',
      statusCode: 409,
    });
  }

  const normalizedPath = normalizeProjectPath(path.resolve(transcriptPath));
  const roots = allowedTranscriptRoots(projectPath);
  if (!roots.some((root) => isPathInside(root, normalizedPath))) {
    throw new AppError('Transcript path is outside provider transcript storage', {
      code: 'UNSAFE_TRANSCRIPT_PATH',
      statusCode: 409,
    });
  }

  try {
    const stats = await fs.lstat(normalizedPath);
    if (stats.isSymbolicLink()) return normalizedPath;
    const realPath = normalizeProjectPath(await fs.realpath(normalizedPath));
    const realRoots = await Promise.all(
      roots.map(async (root) => (await realpathIfExists(root)) ?? root),
    );
    if (!realRoots.some((root) => isPathInside(root, realPath))) {
      throw new AppError('Transcript path escapes provider transcript storage', {
        code: 'UNSAFE_TRANSCRIPT_PATH',
        statusCode: 409,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  return normalizedPath;
}

function uniqueTranscriptPaths(sessions: ProjectSessionRow[]): string[] {
  return Array.from(
    new Set(
      sessions
        .map((session) => session.jsonl_path?.trim())
        .filter((candidate): candidate is string => Boolean(candidate)),
    ),
  );
}

/** Removes every distinct transcript file and fails without changing DB rows. */
export async function deleteSessionJsonlFilesForProjectPath(projectPath: string): Promise<void> {
  const sessions = sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath);
  for (const candidate of uniqueTranscriptPaths(sessions)) {
    const transcriptPath = await validateTranscriptPath(candidate, projectPath);
    try {
      await fs.unlink(transcriptPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export async function getProjectDeletionPreview(projectId: string): Promise<ProjectDeletionPreview> {
  const { row, canonicalPath, workspaceExists } = await resolveSafeProjectTarget(projectId);
  const sessions = sessionsDb.getSessionsByProjectPathIncludingArchived(row.project_path);
  const measured = workspaceExists
    ? await measureTree(canonicalPath)
    : { fileCount: 0, sizeBytes: 0 };

  return {
    canonicalPath,
    workspaceExists,
    sessionCount: sessions.length,
    ...measured,
    activeOperations: projectActivityRegistry.listForPath(canonicalPath),
    git: workspaceExists
      ? await gitRisk(canonicalPath)
      : { repository: false, dirty: null, untracked: null, unpushed: null },
  };
}

/**
 * Soft archive remains CloudCLI-compatible. Permanent deletion requires an
 * archived row and an exact canonical-path confirmation, then removes the
 * workspace tree, provider transcripts, session rows, and project row.
 * Filesystem steps precede one DB transaction so any failure leaves a durable
 * archived checkpoint that can be inspected and retried.
 */
export async function deleteOrArchiveProject(
  projectId: string,
  force: boolean,
  confirmationPath?: string,
): Promise<void> {
  if (!force) {
    const row = projectsDb.getProjectById(projectId);
    if (!row) {
      throw new AppError(`Unknown projectId: ${projectId}`, {
        code: 'PROJECT_NOT_FOUND',
        statusCode: 404,
      });
    }
    projectsDb.updateProjectIsArchivedById(projectId, true);
    return;
  }

  const { row, canonicalPath } = await resolveSafeProjectTarget(projectId);
  if (confirmationPath !== canonicalPath) {
    throw new AppError('Type the exact canonical project path to confirm permanent deletion', {
      code: 'PROJECT_DELETE_CONFIRMATION_MISMATCH',
      statusCode: 400,
      details: { canonicalPath },
    });
  }

  const releaseDeletion = projectActivityRegistry.begin('deletion', canonicalPath);
  try {
    // Re-run every target check while holding the exclusive deletion lease.
    const checked = await resolveSafeProjectTarget(projectId);
    if (checked.canonicalPath !== canonicalPath) {
      throw new AppError('Project path changed during deletion confirmation', {
        code: 'PROJECT_PATH_CHANGED',
        statusCode: 409,
      });
    }

    if (checked.workspaceExists) {
      await fs.rm(canonicalPath, { recursive: true, force: false });
    }
    await deleteSessionJsonlFilesForProjectPath(row.project_path);

    const removeRows = getConnection().transaction(() => {
      sessionsDb.deleteSessionsByProjectPath(row.project_path);
      projectsDb.deleteProjectById(projectId);
    });
    removeRows();
  } finally {
    releaseDeletion();
  }
}

/** Restores one archived project row back into the active project list. */
export function restoreArchivedProject(projectId: string): void {
  const row = projectsDb.getProjectById(projectId);
  if (!row) {
    throw new AppError(`Unknown projectId: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  projectsDb.updateProjectIsArchivedById(projectId, false);
}
