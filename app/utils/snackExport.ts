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
 * Expo ecosystem package names and prefixes.
 * These are provided automatically by Snack for the selected SDK version,
 * so we must NOT send them with template-specific version constraints
 * (which may be incompatible with the Snack SDK version).
 *
 * NOTE: `react-native-*` community packages (e.g. react-native-svg,
 * react-native-reanimated) are NOT filtered — Snack does not auto-provide
 * them, so they must be sent as explicit dependencies. Only `react-native`
 * core and `react-native-web` are exact-matched above.
 */
const EXPO_ECOSYSTEM_EXACT = new Set(['expo', 'react', 'react-dom', 'react-native', 'react-native-web', 'typescript']);

const EXPO_ECOSYSTEM_PREFIXES = ['expo-', '@expo/', '@react-native/', '@react-navigation/'];

function isExpoEcosystemPackage(name: string): boolean {
  if (EXPO_ECOSYSTEM_EXACT.has(name)) {
    return true;
  }

  return EXPO_ECOSYSTEM_PREFIXES.some((prefix) => name.startsWith(prefix));
}

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
 * State listener callback type for SnackSession.
 */
export type SnackSessionStateListener = (state: {
  connectedClients: Record<string, { id: string; name: string; platform: string; status: string }>;
  online: boolean;
  url: string;
}) => void;

/**
 * A live Snack session that connects to Expo Go via QR code.
 *
 * Uses snack-sdk with `online: true` to establish a pubsub channel.
 * The `exp://` URL is available immediately — no `saveAsync()` needed.
 * Connected Expo Go clients receive live code updates automatically.
 */
export class SnackSession {
  private _snack: any;
  private _disposed = false;

  private constructor(snack: any) {
    this._snack = snack;
  }

  /**
   * Create a new live Snack session from the project's FileMap.
   * Lazy-loads snack-sdk to keep the main bundle lean.
   */
  static async create(files: FileMap): Promise<SnackSession> {
    const snackSdk = await import('snack-sdk');

    const pkgJsonContent = findPackageJson(files);

    if (!pkgJsonContent) {
      throw new Error('No package.json found in the project');
    }

    const parsed = JSON.parse(pkgJsonContent);
    const projectName = parsed.name || 'HackCortex Project';
    const projectDescription = parsed.description || 'Exported from Hack Cortex';

    // Build Snack file map
    const snackFiles = buildSnackFiles(files, parsed);

    // Extract non-ecosystem dependencies
    const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
    const snackDependencies = buildSnackDependencies(allDeps);

    // Pick the best SDK version
    const supportedVersions = snackSdk.getSupportedSDKVersions();
    const sdkVersion = pickBestSDKVersion(supportedVersions, allDeps.expo as string | undefined);

    logger.info('Creating live Snack session', {
      fileCount: Object.keys(snackFiles).length,
      depCount: Object.keys(snackDependencies).length,
      sdkVersion,
    });

    // Create the Snack instance with online: true for live session
    const snack = new snackSdk.Snack({
      name: projectName,
      description: projectDescription,
      files: snackFiles,
      dependencies: snackDependencies,
      sdkVersion: sdkVersion as any,
      online: true,
    });

    return new SnackSession(snack);
  }

  /**
   * The `exp://` URL for Expo Go to connect to this session.
   * Available immediately after creation — no save needed.
   */
  get expUrl(): string {
    return this._snack.getState().url;
  }

  /**
   * Map of currently connected Expo Go clients.
   */
  get connectedClients(): Record<string, { id: string; name: string; platform: string; status: string }> {
    return this._snack.getState().connectedClients;
  }

  /**
   * Whether the session is online (pubsub channel active).
   */
  get isOnline(): boolean {
    return this._snack.getState().online;
  }

  /**
   * Whether this session has been disposed.
   */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Subscribe to state changes (connected clients, online status, etc.).
   * Returns an unsubscribe function.
   */
  addStateListener(listener: SnackSessionStateListener): () => void {
    return this._snack.addStateListener((state: any) => {
      listener({
        connectedClients: state.connectedClients,
        online: state.online,
        url: state.url,
      });
    });
  }

  /**
   * Subscribe to log events from connected devices.
   * Returns an unsubscribe function.
   */
  addLogListener(listener: (event: { type: string; message: string }) => void): () => void {
    return this._snack.addLogListener(listener);
  }

  /**
   * Update the Snack session with new project files.
   * Call this when the user edits files in the editor.
   * snack-sdk handles debouncing via codeChangesDelay internally.
   */
  updateFiles(files: FileMap): void {
    if (this._disposed) {
      return;
    }

    const pkgJsonContent = findPackageJson(files);

    if (!pkgJsonContent) {
      return;
    }

    const parsed = JSON.parse(pkgJsonContent);
    const snackFiles = buildSnackFiles(files, parsed);
    const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
    const snackDependencies = buildSnackDependencies(allDeps);

    this._snack.updateFiles(snackFiles);
    this._snack.updateDependencies(snackDependencies);
  }

  /**
   * Force-reload all connected Expo Go clients.
   */
  reloadClients(): void {
    if (!this._disposed) {
      this._snack.reloadConnectedClients();
    }
  }

  /**
   * Tear down the live session. Disconnects from pubsub.
   * The session cannot be reused after this.
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }

    this._disposed = true;

    try {
      this._snack.setOnline(false);
    } catch (error) {
      logger.warn('Error disposing Snack session', error);
    }

    logger.info('Snack session disposed');
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Build the Snack file map from a FileMap, including App.js injection
 * for expo-router projects.
 */
function buildSnackFiles(files: FileMap, parsedPkgJson: any): Record<string, { type: 'CODE'; contents: string }> {
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

  // Inject App.js for expo-router projects that don't have one
  const allDeps = { ...parsedPkgJson.dependencies, ...parsedPkgJson.devDependencies };
  const usesExpoRouter = 'expo-router' in allDeps;

  if (usesExpoRouter && !snackFiles['App.js'] && !snackFiles['App.tsx']) {
    snackFiles['App.js'] = {
      type: 'CODE',
      contents: "import 'expo-router/entry';\n",
    };
  }

  return snackFiles;
}

/**
 * Extract only non-Expo-ecosystem dependencies.
 */
function buildSnackDependencies(allDeps: Record<string, string>): Record<string, { version: string }> {
  const snackDependencies: Record<string, { version: string }> = {};

  for (const [name, version] of Object.entries(allDeps)) {
    if (typeof version === 'string' && !isExpoEcosystemPackage(name)) {
      snackDependencies[name] = { version };
    }
  }

  return snackDependencies;
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
