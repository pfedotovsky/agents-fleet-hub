import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MAX_PROJECT_UPLOAD_BYTES,
  MAX_PROJECT_UPLOAD_FILES,
  persistProjectUploads,
} from '@/modules/files/project-file-upload.service.js';
import { AppError } from '@/shared/utils.js';

async function withWorkspace(
  run: (paths: { root: string; project: string; temp: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fleet-upload-test-'));
  const project = path.join(root, 'project');
  const temp = path.join(root, 'incoming.bin');
  await mkdir(project);
  try {
    await run({ root, project, temp });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function uploadFile(tempPath: string, originalname = 'artifact.bin') {
  return {
    path: tempPath,
    originalname,
    size: 5,
    mimetype: 'application/octet-stream',
  };
}

test('persistProjectUploads preserves binary bytes and creates nested directories', async () => {
  await withWorkspace(async ({ project, temp }) => {
    const bytes = Buffer.from([0x00, 0xff, 0x41, 0x80, 0x0a]);
    await writeFile(temp, bytes);

    const result = await persistProjectUploads({
      projectRoot: project,
      targetPath: '',
      relativePaths: ['assets/nested/artifact.bin'],
      files: [uploadFile(temp)],
      overwrite: false,
    });

    assert.deepEqual(await readFile(path.join(project, 'assets/nested/artifact.bin')), bytes);
    assert.equal(result.files[0]?.name, path.join('assets', 'nested', 'artifact.bin'));
  });
});

test('persistProjectUploads rejects target and file traversal outside the project', async () => {
  await withWorkspace(async ({ project, temp }) => {
    await writeFile(temp, 'safe');
    const file = uploadFile(temp);

    await assert.rejects(
      persistProjectUploads({
        projectRoot: project,
        targetPath: '../outside',
        files: [file],
        overwrite: false,
      }),
      (error: unknown) => error instanceof AppError && error.code === 'UPLOAD_TARGET_OUTSIDE_PROJECT',
    );
    await assert.rejects(
      persistProjectUploads({
        projectRoot: project,
        targetPath: '',
        relativePaths: ['../outside.bin'],
        files: [file],
        overwrite: false,
      }),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_UPLOAD_PATH',
    );
  });
});

test('persistProjectUploads refuses conflicts unless overwrite is explicit', async () => {
  await withWorkspace(async ({ project, temp }) => {
    const destination = path.join(project, 'artifact.bin');
    await writeFile(destination, 'original');
    await writeFile(temp, 'replacement');

    await assert.rejects(
      persistProjectUploads({
        projectRoot: project,
        files: [uploadFile(temp)],
        overwrite: false,
      }),
      (error: unknown) => error instanceof AppError && error.code === 'UPLOAD_CONFLICT',
    );
    assert.equal(await readFile(destination, 'utf8'), 'original');

    await persistProjectUploads({
      projectRoot: project,
      files: [uploadFile(temp)],
      overwrite: true,
    });
    assert.equal(await readFile(destination, 'utf8'), 'replacement');
  });
});

test('persistProjectUploads rejects mismatched and duplicate destination lists', async () => {
  await withWorkspace(async ({ project, temp }) => {
    await writeFile(temp, 'safe');
    const files = [uploadFile(temp, 'one.bin'), uploadFile(temp, 'two.bin')];

    await assert.rejects(
      persistProjectUploads({
        projectRoot: project,
        relativePaths: ['one.bin'],
        files,
        overwrite: false,
      }),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_UPLOAD_PATHS',
    );
    await assert.rejects(
      persistProjectUploads({
        projectRoot: project,
        relativePaths: ['same.bin', 'same.bin'],
        files,
        overwrite: false,
      }),
      (error: unknown) =>
        error instanceof AppError && error.code === 'DUPLICATE_UPLOAD_DESTINATION',
    );
  });
});

test('persistProjectUploads rejects configured count and size limits', async () => {
  await withWorkspace(async ({ project, temp }) => {
    await writeFile(temp, 'safe');
    const tooMany = Array.from({ length: MAX_PROJECT_UPLOAD_FILES + 1 }, (_, index) =>
      uploadFile(temp, `${index}.bin`),
    );

    await assert.rejects(
      persistProjectUploads({ projectRoot: project, files: tooMany, overwrite: false }),
      (error: unknown) => error instanceof AppError && error.code === 'TOO_MANY_UPLOAD_FILES',
    );
    await assert.rejects(
      persistProjectUploads({
        projectRoot: project,
        files: [{ ...uploadFile(temp), size: MAX_PROJECT_UPLOAD_BYTES + 1 }],
        overwrite: false,
      }),
      (error: unknown) => error instanceof AppError && error.code === 'UPLOAD_FILE_TOO_LARGE',
    );
  });
});

test('persistProjectUploads rejects symlink escapes below the project root', async () => {
  await withWorkspace(async ({ root, project, temp }) => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(temp, 'safe');
    await symlink(outside, path.join(project, 'linked'));

    await assert.rejects(
      persistProjectUploads({
        projectRoot: project,
        targetPath: 'linked',
        files: [uploadFile(temp)],
        overwrite: false,
      }),
      (error: unknown) => error instanceof AppError && error.code === 'UPLOAD_SYMLINK_NOT_ALLOWED',
    );
  });
});
