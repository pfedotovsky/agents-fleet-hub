import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
import { projectActivityRegistry } from '@/modules/projects/services/project-activity.service.js';
import {
  deleteOrArchiveProject,
  getProjectDeletionPreview,
  restoreArchivedProject,
} from '@/modules/projects/services/project-delete.service.js';
import { createProject } from '@/modules/projects/services/project-management.service.js';
import { AppError } from '@/shared/utils.js';

type Fixture = {
  root: string;
  workspaceRoot: string;
  codexHome: string;
};

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function withDeletionFixture(runTest: (fixture: Fixture) => Promise<void>): Promise<void> {
  const previous = {
    databasePath: process.env.DATABASE_PATH,
    fleetServerHome: process.env.FLEET_SERVER_HOME,
    workspacesRoot: process.env.WORKSPACES_ROOT,
    codexHome: process.env.CODEX_HOME,
  };
  const createdRoot = await mkdtemp(path.join(os.tmpdir(), 'project-delete-'));
  const root = await realpath(createdRoot);
  const workspaceRoot = path.join(root, 'workspaces');
  const fleetServerHome = path.join(root, 'fleet-state');
  const codexHome = path.join(root, 'codex-home');
  const databasePath = path.join(fleetServerHome, 'auth.db');
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(fleetServerHome, { recursive: true }),
    mkdir(path.join(codexHome, 'sessions'), { recursive: true }),
  ]);
  // An existing empty fixture DB prevents the connection bootstrap from
  // adopting a user's legacy CloudCLI database into this destructive test.
  await writeFile(databasePath, '');

  closeConnection();
  projectActivityRegistry.clearAll();
  process.env.DATABASE_PATH = databasePath;
  process.env.FLEET_SERVER_HOME = fleetServerHome;
  process.env.WORKSPACES_ROOT = workspaceRoot;
  process.env.CODEX_HOME = codexHome;
  await initializeDatabase();

  try {
    await runTest({ root, workspaceRoot, codexHome });
  } finally {
    projectActivityRegistry.clearAll();
    closeConnection();
    for (const [key, value] of Object.entries(previous)) {
      const envKey = {
        databasePath: 'DATABASE_PATH',
        fleetServerHome: 'FLEET_SERVER_HOME',
        workspacesRoot: 'WORKSPACES_ROOT',
        codexHome: 'CODEX_HOME',
      }[key] as string;
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

function expectAppError(code: string): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    return true;
  };
}

test('preview and permanent deletion enforce confirmation, activity, and symlink safety', async () => {
  await withDeletionFixture(async ({ root, workspaceRoot, codexHome }) => {
    const projectPath = path.join(workspaceRoot, 'demo');
    const outsideFile = path.join(root, 'outside.txt');
    const transcriptPath = path.join(codexHome, 'sessions', 'session-1.jsonl');
    await mkdir(path.join(projectPath, 'src'), { recursive: true });
    await writeFile(path.join(projectPath, 'src', 'index.ts'), 'export {}\n');
    await writeFile(outsideFile, 'keep me');
    await symlink(outsideFile, path.join(projectPath, 'outside-link'));
    await writeFile(transcriptPath, '{"type":"session_meta"}\n');

    const created = projectsDb.createProjectPath(projectPath, 'Demo');
    const projectId = created.project?.project_id as string;
    sessionsDb.createSession(
      'session-1',
      'codex',
      projectPath,
      'Session',
      undefined,
      undefined,
      transcriptPath,
    );
    projectsDb.updateProjectIsArchivedById(projectId, true);

    const releaseTerminal = projectActivityRegistry.begin('terminal', projectPath);
    const preview = await getProjectDeletionPreview(projectId);
    assert.equal(preview.canonicalPath, projectPath);
    assert.equal(preview.sessionCount, 1);
    assert.equal(preview.fileCount, 2);
    assert.ok(preview.sizeBytes > 0);
    assert.deepEqual(preview.activeOperations, ['terminal']);

    await assert.rejects(
      deleteOrArchiveProject(projectId, true, projectPath),
      expectAppError('PROJECT_BUSY'),
    );
    releaseTerminal();

    await assert.rejects(
      deleteOrArchiveProject(projectId, true, `${projectPath}/wrong`),
      expectAppError('PROJECT_DELETE_CONFIRMATION_MISMATCH'),
    );
    assert.ok(projectsDb.getProjectById(projectId));

    await deleteOrArchiveProject(projectId, true, projectPath);

    assert.equal(projectsDb.getProjectById(projectId), null);
    assert.equal(sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath).length, 0);
    assert.equal(await pathExists(projectPath), false);
    assert.equal(await pathExists(transcriptPath), false);
    assert.equal(await readFile(outsideFile, 'utf8'), 'keep me');
  });
});

test('filesystem failure leaves an archived checkpoint and retry completes deletion', async () => {
  await withDeletionFixture(async ({ workspaceRoot, codexHome }) => {
    const projectPath = path.join(workspaceRoot, 'retryable');
    const invalidTranscript = path.join(codexHome, 'sessions', 'blocked.jsonl');
    await mkdir(projectPath, { recursive: true });
    await writeFile(path.join(projectPath, 'work.txt'), 'temporary');
    await mkdir(invalidTranscript, { recursive: true });

    const created = projectsDb.createProjectPath(projectPath, 'Retryable');
    const projectId = created.project?.project_id as string;
    sessionsDb.createSession(
      'session-retry',
      'codex',
      projectPath,
      'Retry',
      undefined,
      undefined,
      invalidTranscript,
    );
    projectsDb.updateProjectIsArchivedById(projectId, true);

    await assert.rejects(deleteOrArchiveProject(projectId, true, projectPath));
    assert.equal(await pathExists(projectPath), false);
    assert.equal(projectsDb.getProjectById(projectId)?.isArchived, 1);
    assert.equal(sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath).length, 1);

    await rm(invalidTranscript, { recursive: true });
    await deleteOrArchiveProject(projectId, true, projectPath);
    assert.equal(projectsDb.getProjectById(projectId), null);
  });
});

test('permanent deletion rejects workspace roots, symlink roots, and project ancestors', async () => {
  await withDeletionFixture(async ({ root, workspaceRoot }) => {
    const rootProject = projectsDb.createProjectPath(workspaceRoot, 'Root');
    const rootProjectId = rootProject.project?.project_id as string;
    projectsDb.updateProjectIsArchivedById(rootProjectId, true);
    await assert.rejects(
      getProjectDeletionPreview(rootProjectId),
      expectAppError('PROTECTED_PROJECT_PATH'),
    );

    const realProjectPath = path.join(workspaceRoot, 'real-project');
    const symlinkProjectPath = path.join(workspaceRoot, 'linked-project');
    await mkdir(realProjectPath, { recursive: true });
    await symlink(realProjectPath, symlinkProjectPath);
    const symlinkProject = projectsDb.createProjectPath(symlinkProjectPath, 'Linked');
    const symlinkProjectId = symlinkProject.project?.project_id as string;
    projectsDb.updateProjectIsArchivedById(symlinkProjectId, true);
    await assert.rejects(
      getProjectDeletionPreview(symlinkProjectId),
      expectAppError('PROJECT_SYMLINK_ROOT'),
    );

    const broadPath = path.join(workspaceRoot, 'broad');
    const nestedPath = path.join(broadPath, 'nested');
    await mkdir(nestedPath, { recursive: true });
    const broadProject = projectsDb.createProjectPath(broadPath, 'Broad');
    const nestedProject = projectsDb.createProjectPath(nestedPath, 'Nested');
    assert.ok(nestedProject.project);
    const broadProjectId = broadProject.project?.project_id as string;
    projectsDb.updateProjectIsArchivedById(broadProjectId, true);
    await assert.rejects(
      getProjectDeletionPreview(broadProjectId),
      expectAppError('PROJECT_PATH_TOO_BROAD'),
    );

    assert.equal(await pathExists(path.join(root, 'fleet-state', 'auth.db')), true);
  });
});

test('permanent deletion rejects projects nested inside fleet-server state', async () => {
  await withDeletionFixture(async ({ root }) => {
    const fleetStateProjectPath = path.join(root, 'fleet-state', 'nested-project');
    await mkdir(fleetStateProjectPath, { recursive: true });
    process.env.WORKSPACES_ROOT = root;

    const created = projectsDb.createProjectPath(fleetStateProjectPath, 'Fleet state child');
    const projectId = created.project?.project_id as string;
    projectsDb.updateProjectIsArchivedById(projectId, true);

    await assert.rejects(
      getProjectDeletionPreview(projectId),
      expectAppError('PROTECTED_PROJECT_PATH'),
    );
  });
});

test('deletion lease blocks project restore and registration races', async () => {
  await withDeletionFixture(async ({ workspaceRoot }) => {
    const projectPath = path.join(workspaceRoot, 'lifecycle-race');
    await mkdir(projectPath, { recursive: true });
    const created = projectsDb.createProjectPath(projectPath, 'Lifecycle race');
    const projectId = created.project?.project_id as string;
    projectsDb.updateProjectIsArchivedById(projectId, true);

    const releaseDeletion = projectActivityRegistry.begin('deletion', projectPath);
    try {
      assert.throws(
        () => restoreArchivedProject(projectId),
        expectAppError('PROJECT_BUSY'),
      );
      await assert.rejects(
        createProject(
          { projectPath },
          {
            validatePath: async () => ({ valid: true, resolvedPath: projectPath }),
            ensureWorkspaceDirectory: async () => undefined,
            persistProjectPath: () => {
              throw new Error('registration must not start while deletion holds the lease');
            },
            getProjectByPath: () => null,
          },
        ),
        expectAppError('PROJECT_BUSY'),
      );
    } finally {
      releaseDeletion();
    }

    assert.equal(projectsDb.getProjectById(projectId)?.isArchived, 1);
  });
});
