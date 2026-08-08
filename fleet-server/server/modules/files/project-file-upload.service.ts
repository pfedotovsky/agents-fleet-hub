import { constants as fsConstants } from 'node:fs';
import { access, copyFile, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { projectActivityRegistry } from '@/modules/projects/services/project-activity.service.js';
import { AppError } from '@/shared/utils.js';

export const MAX_PROJECT_UPLOAD_FILES = 20;
export const MAX_PROJECT_UPLOAD_BYTES = 200 * 1024 * 1024;

export type TemporaryUploadFile = {
  path: string;
  originalname: string;
  size: number;
  mimetype: string;
};

export type UploadedProjectFile = {
  name: string;
  path: string;
  size: number;
  mimeType: string;
};

type PersistProjectUploadsInput = {
  projectRoot: string;
  targetPath?: string;
  relativePaths?: unknown;
  files: TemporaryUploadFile[];
  overwrite: boolean;
};

type UploadDependencies = {
  pathExists: (filePath: string) => Promise<boolean>;
  ensureDirectory: (directoryPath: string) => Promise<void>;
  copyTemporaryFile: (sourcePath: string, destinationPath: string, overwrite: boolean) => Promise<void>;
};

async function defaultPathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

const defaultDependencies: UploadDependencies = {
  pathExists: defaultPathExists,
  ensureDirectory: async (directoryPath) => {
    await mkdir(directoryPath, { recursive: true });
  },
  copyTemporaryFile: async (sourcePath, destinationPath, overwrite) => {
    await copyFile(sourcePath, destinationPath, overwrite ? 0 : fsConstants.COPYFILE_EXCL);
  },
};

async function rejectSymlinksBelowProject(projectRoot: string, candidate: string): Promise<void> {
  const relative = path.relative(projectRoot, candidate);
  if (!relative) return;

  let current = projectRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new AppError('Upload paths cannot pass through symbolic links', {
          code: 'UPLOAD_SYMLINK_NOT_ALLOWED',
          statusCode: 403,
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function isInsideProject(projectRoot: string, candidate: string): boolean {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function normalizeRelativeUploadPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new AppError('Every uploaded file must have a valid relative path', {
      code: 'INVALID_UPLOAD_PATH',
      statusCode: 400,
    });
  }

  const normalized = value.trim().replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw new AppError('Uploaded file paths must be relative', {
      code: 'INVALID_UPLOAD_PATH',
      statusCode: 400,
    });
  }

  const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    throw new AppError('Uploaded file paths must stay inside the project', {
      code: 'INVALID_UPLOAD_PATH',
      statusCode: 403,
    });
  }

  return segments.join(path.sep);
}

function resolveRelativePaths(files: TemporaryUploadFile[], relativePaths: unknown): string[] {
  if (relativePaths === undefined) {
    return files.map((file) => normalizeRelativeUploadPath(file.originalname));
  }
  if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
    throw new AppError('relativePaths must contain one path for every uploaded file', {
      code: 'INVALID_UPLOAD_PATHS',
      statusCode: 400,
    });
  }
  return relativePaths.map(normalizeRelativeUploadPath);
}

async function persistProjectUploadsUnlocked(
  input: PersistProjectUploadsInput,
  dependencies: UploadDependencies = defaultDependencies,
): Promise<{ targetPath: string; files: UploadedProjectFile[] }> {
  if (input.files.length === 0) {
    throw new AppError('No files provided', {
      code: 'NO_UPLOAD_FILES',
      statusCode: 400,
    });
  }
  if (input.files.length > MAX_PROJECT_UPLOAD_FILES) {
    throw new AppError(`Choose at most ${MAX_PROJECT_UPLOAD_FILES} files per upload`, {
      code: 'TOO_MANY_UPLOAD_FILES',
      statusCode: 400,
    });
  }
  const oversized = input.files.find((file) => file.size > MAX_PROJECT_UPLOAD_BYTES);
  if (oversized) {
    throw new AppError('An uploaded file exceeds the 200 MB limit', {
      code: 'UPLOAD_FILE_TOO_LARGE',
      statusCode: 400,
    });
  }

  const projectRoot = path.resolve(input.projectRoot);
  const requestedTarget = input.targetPath?.trim();
  const targetPath = !requestedTarget || requestedTarget === '.' || requestedTarget === './'
    ? projectRoot
    : path.isAbsolute(requestedTarget)
      ? path.resolve(requestedTarget)
      : path.resolve(projectRoot, requestedTarget);

  if (!isInsideProject(projectRoot, targetPath)) {
    throw new AppError('Path must be under project root', {
      code: 'UPLOAD_TARGET_OUTSIDE_PROJECT',
      statusCode: 403,
    });
  }
  await rejectSymlinksBelowProject(projectRoot, targetPath);

  const relativePaths = resolveRelativePaths(input.files, input.relativePaths);
  const plans = input.files.map((file, index) => {
    const relativePath = relativePaths[index];
    const destinationPath = path.resolve(targetPath, relativePath);
    if (!isInsideProject(projectRoot, destinationPath)) {
      throw new AppError('Uploaded file paths must stay inside the project', {
        code: 'UPLOAD_DESTINATION_OUTSIDE_PROJECT',
        statusCode: 403,
      });
    }
    return { file, relativePath, destinationPath };
  });

  const uniqueDestinations = new Set(plans.map((plan) => plan.destinationPath));
  if (uniqueDestinations.size !== plans.length) {
    throw new AppError('Upload contains duplicate destination paths', {
      code: 'DUPLICATE_UPLOAD_DESTINATION',
      statusCode: 400,
    });
  }

  await Promise.all(
    plans.map((plan) => rejectSymlinksBelowProject(projectRoot, plan.destinationPath)),
  );

  if (!input.overwrite) {
    const conflicts = (
      await Promise.all(
        plans.map(async (plan) =>
          (await dependencies.pathExists(plan.destinationPath)) ? plan.relativePath : null,
        ),
      )
    ).filter((filePath): filePath is string => filePath !== null);
    if (conflicts.length > 0) {
      throw new AppError('One or more files already exist', {
        code: 'UPLOAD_CONFLICT',
        statusCode: 409,
        details: conflicts,
      });
    }
  }

  await dependencies.ensureDirectory(targetPath);
  const uploadedFiles: UploadedProjectFile[] = [];
  for (const plan of plans) {
    await dependencies.ensureDirectory(path.dirname(plan.destinationPath));
    await dependencies.copyTemporaryFile(plan.file.path, plan.destinationPath, input.overwrite);
    uploadedFiles.push({
      name: plan.relativePath,
      path: plan.destinationPath,
      size: plan.file.size,
      mimeType: plan.file.mimetype,
    });
  }

  return { targetPath, files: uploadedFiles };
}

export async function persistProjectUploads(
  input: PersistProjectUploadsInput,
  dependencies: UploadDependencies = defaultDependencies,
): Promise<{ targetPath: string; files: UploadedProjectFile[] }> {
  const releaseProjectActivity = projectActivityRegistry.begin('file', input.projectRoot);
  try {
    return await persistProjectUploadsUnlocked(input, dependencies);
  } finally {
    releaseProjectActivity();
  }
}
