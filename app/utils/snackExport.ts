import type { FileMap } from '~/lib/stores/files';
import { extractRelativePath } from '~/utils/diff';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('SnackExport');

/**
 * Directories and files to exclude from the Snack export.
 */
const EXCLUDED_PATHS = ['node_modules/', '.git/', '.hackcortex/', '.bolt/', '.expo/', 'dist/', 'build/', '.cache/'];

const EXCLUDED_FILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  '.DS_Store',
  'Thumbs.db',
  '.gitignore',
];

/**
 * Checks whether the current project in the FileMap is an Expo project
 * by looking for "expo" in package.json dependencies.
 */
export function isExpoProject(files: FileMap): boolean {
  const pkgJson = findPackageJson(files);

  if (!pkgJson) {
    return false;
  }

  try {
    const parsed = JSON.parse(pkgJson);
    const deps = { ...parsed.dependencies, ...parsed.devDependencies };

    return 'expo' in deps;
  } catch {
    return false;
  }
}

/**
 * Exports the current project files to Expo Snack.
 * Lazy-loads snack-sdk on first call to keep the main bundle lean.
 *
 * @returns The full Snack URL (e.g. https://snack.expo.dev/abc123)
 */
export async function exportToExpoSnack(files: FileMap): Promise<string> {
  // Lazy-load snack-sdk — named export, not default
  const snackSdk = await import('snack-sdk');

  const pkgJsonContent = findPackageJson(files);

  if (!pkgJsonContent) {
    throw new Error('No package.json found in the project');
  }

  const parsed = JSON.parse(pkgJsonContent);
  const projectName = parsed.name || 'HackCortex Project';
  const projectDescription = parsed.description || 'Exported from Hack Cortex';

  // Build Snack file map
  const snackFiles: Record<string, { type: 'CODE'; contents: string }> = {};

  for (const [filePath, dirent] of Object.entries(files)) {
    if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
      continue;
    }

    const relativePath = extractRelativePath(filePath);

    if (shouldExclude(relativePath)) {
      continue;
    }

    snackFiles[relativePath] = {
      type: 'CODE',
      contents: dirent.content,
    };
  }

  // Extract dependencies with versions
  const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
  const snackDependencies: Record<string, { version: string }> = {};

  for (const [name, version] of Object.entries(allDeps)) {
    if (typeof version === 'string') {
      snackDependencies[name] = { version };
    }
  }

  // Determine the best SDK version supported by snack-sdk
  const supportedVersions = snackSdk.getSupportedSDKVersions();
  const sdkVersion = pickBestSDKVersion(supportedVersions, allDeps.expo as string | undefined);

  logger.info('Exporting to Expo Snack', {
    fileCount: Object.keys(snackFiles).length,
    depCount: Object.keys(snackDependencies).length,
    sdkVersion,
  });

  // Create the Snack instance
  const snack = new snackSdk.Snack({
    name: projectName,
    description: projectDescription,
    files: snackFiles,
    dependencies: snackDependencies,

    /*
     * Cast needed because pickBestSDKVersion returns one of the supported values,
     * but TypeScript can't infer it narrows to the SDKVersion union type.
     */
    sdkVersion: sdkVersion as Parameters<typeof snackSdk.Snack.prototype.setSDKVersion>[0],
  });

  // Save to Expo servers (anonymous, no account needed)
  const { id } = await snack.saveAsync();

  const url = `https://snack.expo.dev/${id}`;
  logger.info('Snack saved successfully', { id, url });

  return url;
}

/**
 * Find the package.json content from the FileMap.
 */
function findPackageJson(files: FileMap): string | null {
  for (const [filePath, dirent] of Object.entries(files)) {
    if (!dirent || dirent.type !== 'file') {
      continue;
    }

    const relativePath = extractRelativePath(filePath);

    if (relativePath === 'package.json') {
      return dirent.content;
    }
  }

  return null;
}

/**
 * Determines if a relative file path should be excluded from export.
 */
function shouldExclude(relativePath: string): boolean {
  for (const dir of EXCLUDED_PATHS) {
    if (relativePath.startsWith(dir) || relativePath.includes(`/${dir}`)) {
      return true;
    }
  }

  return EXCLUDED_FILES.includes(relativePath);
}

/**
 * Picks the best SDK version from the supported list.
 * Tries to match the project's expo version major; falls back to the newest supported.
 */
function pickBestSDKVersion(
  supportedVersions: string[],
  expoVersion: string | undefined,
): (typeof supportedVersions)[number] {
  if (!supportedVersions.length) {
    return '52.0.0';
  }

  // Sort supported versions by major descending
  const sorted = [...supportedVersions].sort((a, b) => {
    const majorA = parseInt(a.split('.')[0], 10);
    const majorB = parseInt(b.split('.')[0], 10);

    return majorB - majorA;
  });

  if (expoVersion) {
    // Extract major version from expo dep (e.g. "~55.0.0" → 55)
    const cleaned = expoVersion.replace(/^[^0-9]*/, '');
    const projectMajor = parseInt(cleaned.split('.')[0], 10);

    if (!isNaN(projectMajor)) {
      // Find exact major match
      const exactMatch = sorted.find((v) => parseInt(v.split('.')[0], 10) === projectMajor);

      if (exactMatch) {
        return exactMatch;
      }

      /*
       * If project SDK is newer than what's supported, use the newest supported.
       * If project SDK is older, find the closest older or use newest.
       */
    }
  }

  // Default to newest supported version
  return sorted[0];
}
