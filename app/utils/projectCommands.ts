import type { Message } from 'ai';
import { generateId } from './fileUtils';

export interface ProjectCommands {
  type: string;
  setupCommand?: string;
  startCommand?: string;
  followupMessage: string;
}

interface FileContent {
  content: string;
  path: string;
}

// Helper function to make any command non-interactive
function makeNonInteractive(command: string): string {
  /*
   * Use inline env vars (VAR=val command) instead of `export VAR=val && command`.
   * WebContainer's jsh shell does not reliably support multi-variable `export`
   * (e.g. `export A=1 B=2 C=3`), which can silently fail and block subsequent
   * `&&`-chained commands from running.
   *
   * CI=true is already set by WebContainer, but we set it explicitly for
   * consistency. DEBIAN_FRONTEND and FORCE_COLOR prevent interactive prompts
   * and colored output that can confuse terminal output parsing.
   */
  const envPrefix = 'CI=true DEBIAN_FRONTEND=noninteractive FORCE_COLOR=0';

  // Common interactive packages and their non-interactive flags
  const interactivePackages = [
    { pattern: /npx\s+([^@\s]+@?[^\s]*)\s+init/g, replacement: 'echo "y" | npx --yes $1 init --defaults --yes' },
    { pattern: /npx\s+create-([^\s]+)/g, replacement: 'npx --yes create-$1 --template default' },
    { pattern: /npx\s+([^@\s]+@?[^\s]*)\s+add/g, replacement: 'npx --yes $1 add --defaults --yes' },
    { pattern: /npm\s+install(?!\s+--)/g, replacement: 'npm install --no-audit --no-fund' },
    { pattern: /yarn\s+add(?!\s+--)/g, replacement: 'yarn add --non-interactive' },
    { pattern: /pnpm\s+add(?!\s+--)/g, replacement: 'pnpm add --yes' },
  ];

  let processedCommand = command;

  // Apply replacements for known interactive patterns
  interactivePackages.forEach(({ pattern, replacement }) => {
    processedCommand = processedCommand.replace(pattern, replacement);
  });

  return `${envPrefix} ${processedCommand}`;
}

export async function detectProjectCommands(files: FileContent[]): Promise<ProjectCommands> {
  const hasFile = (name: string) => files.some((f) => f.path.endsWith(name));
  const hasFileContent = (name: string, content: string) =>
    files.some((f) => f.path.endsWith(name) && f.content.includes(content));

  if (hasFile('package.json')) {
    const packageJsonFile = files.find((f) => f.path.endsWith('package.json'));

    if (!packageJsonFile) {
      return { type: '', setupCommand: '', followupMessage: '' };
    }

    try {
      const packageJson = JSON.parse(packageJsonFile.content);
      const scripts = packageJson?.scripts || {};
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

      // Check if this is a shadcn project
      const isShadcnProject =
        hasFileContent('components.json', 'shadcn') ||
        Object.keys(dependencies).some((dep) => dep.includes('shadcn')) ||
        hasFile('components.json');

      // Check if this is an Expo project
      const isExpoProject = 'expo' in dependencies;

      // Check for preferred commands in priority order
      const preferredCommands = ['dev', 'start', 'preview'];
      const availableCommand = preferredCommands.find((cmd) => scripts[cmd]);

      /*
       * Build setup command with non-interactive handling.
       * Skip browserslist update for Expo projects — it's unnecessary and can hang in WebContainer.
       */
      let baseSetupCommand = isExpoProject ? 'npm install' : 'npx update-browserslist-db@latest && npm install';

      // Add shadcn init if it's a shadcn project
      if (isShadcnProject) {
        baseSetupCommand += ' && npx shadcn@latest init';
      }

      const setupCommand = makeNonInteractive(baseSetupCommand);

      if (availableCommand) {
        return {
          type: 'Node.js',
          setupCommand,
          startCommand: `npm run ${availableCommand}`,
          followupMessage: `Found "${availableCommand}" script in package.json. Running "npm run ${availableCommand}" after installation.`,
        };
      }

      return {
        type: 'Node.js',
        setupCommand,
        followupMessage:
          'Would you like me to inspect package.json to determine the available scripts for running this project?',
      };
    } catch (error) {
      console.error('Error parsing package.json:', error);
      return { type: '', setupCommand: '', followupMessage: '' };
    }
  }

  if (hasFile('index.html')) {
    return {
      type: 'Static',
      startCommand: 'npx --yes serve',
      followupMessage: '',
    };
  }

  return { type: '', setupCommand: '', followupMessage: '' };
}

export function createCommandsMessage(commands: ProjectCommands): Message | null {
  if (!commands.setupCommand && !commands.startCommand) {
    return null;
  }

  let commandString = '';

  if (commands.setupCommand) {
    commandString += `
<boltAction type="shell">${commands.setupCommand}</boltAction>`;
  }

  if (commands.startCommand) {
    commandString += `
<boltAction type="start">${commands.startCommand}</boltAction>
`;
  }

  return {
    role: 'assistant',
    content: `
${commands.followupMessage ? `\n\n${commands.followupMessage}` : ''}
<boltArtifact id="project-setup" title="Project Setup">
${commandString}
</boltArtifact>`,
    id: generateId(),
    createdAt: new Date(),
  };
}

/**
 * Generates quick-action buttons markup for Install + Run.
 * Detects the correct start script from package.json among the provided files.
 */
export function getSetupButtonsMarkup(files: FileContent[]): string {
  let startScript = 'dev';
  const packageJsonFile = files.find((f) => f.path.endsWith('package.json'));

  if (packageJsonFile) {
    try {
      const packageJson = JSON.parse(packageJsonFile.content);
      const scripts = packageJson?.scripts || {};
      const preferredCommands = ['dev', 'start', 'preview'];
      startScript = preferredCommands.find((cmd) => scripts[cmd]) || 'dev';
    } catch {
      // fallback to 'dev'
    }
  }

  return `\nClick the buttons below to install dependencies and start the dev server.\n\n<bolt-quick-actions>\n<bolt-quick-action type="shell" message="npm install">Install Dependencies</bolt-quick-action>\n<bolt-quick-action type="shell" message="npm run ${startScript}">Start Dev Server</bolt-quick-action>\n</bolt-quick-actions>`;
}

export function escapeBoltArtifactTags(input: string) {
  // Regular expression to match boltArtifact tags and their content
  const regex = /(<boltArtifact[^>]*>)([\s\S]*?)(<\/boltArtifact>)/g;

  return input.replace(regex, (match, openTag, content, closeTag) => {
    // Escape the opening tag
    const escapedOpenTag = openTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Escape the closing tag
    const escapedCloseTag = closeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Return the escaped version
    return `${escapedOpenTag}${content}${escapedCloseTag}`;
  });
}

export function escapeBoltAActionTags(input: string) {
  // Regular expression to match boltArtifact tags and their content
  const regex = /(<boltAction[^>]*>)([\s\S]*?)(<\/boltAction>)/g;

  return input.replace(regex, (match, openTag, content, closeTag) => {
    // Escape the opening tag
    const escapedOpenTag = openTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Escape the closing tag
    const escapedCloseTag = closeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Return the escaped version
    return `${escapedOpenTag}${content}${escapedCloseTag}`;
  });
}

export function escapeBoltTags(input: string) {
  return escapeBoltArtifactTags(escapeBoltAActionTags(input));
}

// We have this seperate function to simplify the restore snapshot process in to one single artifact.
export function createCommandActionsString(commands: ProjectCommands): string {
  if (!commands.setupCommand && !commands.startCommand) {
    // Return empty string if no commands
    return '';
  }

  let commandString = '';

  if (commands.setupCommand) {
    commandString += `
<boltAction type="shell">${commands.setupCommand}</boltAction>`;
  }

  if (commands.startCommand) {
    commandString += `
<boltAction type="start">${commands.startCommand}</boltAction>
`;
  }

  return commandString;
}
