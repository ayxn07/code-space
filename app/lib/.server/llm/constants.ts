/*
 * Maximum tokens for response generation (updated for modern model capabilities)
 * This serves as a fallback when model-specific limits are unavailable
 * Modern models like Claude 3.5, GPT-4o, and Gemini Pro support 128k+ tokens
 */
export const MAX_TOKENS = 128000;

/*
 * Provider-specific default completion token limits
 * Used as fallbacks when model doesn't specify maxCompletionTokens.
 * These should be generous — the model's own limit (from API metadata)
 * is preferred and will override these when available.
 */
export const PROVIDER_COMPLETION_LIMITS: Record<string, number> = {
  OpenAI: 16384, // GPT-4o supports 16k output; o1/o3 have model-specific overrides
  Github: 16384, // GitHub Models — mirrors OpenAI capabilities
  Anthropic: 128000, // Claude 3.5/3.7/4 Sonnet all support 64-128k output
  Google: 65536, // Gemini 2.5 Pro supports 65k; Flash is lower but set per-model
  Cohere: 4000,
  DeepSeek: 16384, // DeepSeek R1 supports 16k; V3 is uncapped
  Groq: 8192,
  HuggingFace: 8192,
  Mistral: 16384,
  Ollama: 8192,
  OpenRouter: 32768, // Generous fallback; dynamic models read actual limit from API
  Perplexity: 16384,
  Together: 16384,
  xAI: 16384,
  LMStudio: 8192,
  OpenAILike: 16384,
  AmazonBedrock: 8192,
  Hyperbolic: 8192,
};

/*
 * Reasoning models that require maxCompletionTokens instead of maxTokens
 * These models use internal reasoning tokens and have different API parameter requirements
 */
export function isReasoningModel(modelName: string): boolean {
  return /^(o1|o3|gpt-5)/i.test(modelName);
}

// limits the number of continuation segments when a response hits the token limit
export const MAX_RESPONSE_SEGMENTS = 4;

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
  isLocked?: boolean;
  lockedByFolder?: string;
}

export interface Folder {
  type: 'folder';
  isLocked?: boolean;
  lockedByFolder?: string;
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
  '**/*lock.json',
  '**/*lock.yml',
];
