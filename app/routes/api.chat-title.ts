import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';

export async function action(args: ActionFunctionArgs) {
  return titleAction(args);
}

const logger = createScopedLogger('api.chat-title');

async function titleAction({ context, request }: ActionFunctionArgs) {
  const { message, model, provider } = await request.json<{
    message: string;
    model?: string;
    provider?: string;
  }>();

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing or invalid message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);
  const serverEnv = context.cloudflare?.env;

  const currentModel = model || DEFAULT_MODEL;
  const currentProviderName = provider || DEFAULT_PROVIDER.name;

  const providerInfo = PROVIDER_LIST.find((p) => p.name === currentProviderName) || DEFAULT_PROVIDER;
  const staticModels = LLMManager.getInstance().getStaticModelListFromProvider(providerInfo);
  let modelDetails = staticModels.find((m) => m.name === currentModel);

  if (!modelDetails) {
    const modelsList = [
      ...(providerInfo.staticModels || []),
      ...(await LLMManager.getInstance().getModelListFromProvider(providerInfo, {
        apiKeys,
        providerSettings,
        serverEnv: serverEnv as any,
      })),
    ];

    modelDetails = modelsList.find((m) => m.name === currentModel);

    if (!modelDetails && modelsList.length > 0) {
      modelDetails = modelsList[0];
    }

    if (!modelDetails) {
      logger.warn(`No models found for provider ${providerInfo.name}, returning truncated title`);

      return new Response(JSON.stringify({ title: message.slice(0, 57).trim() + (message.length > 57 ? '...' : '') }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const resp = await generateText({
      model: providerInfo.getModelInstance({
        model: modelDetails.name,
        serverEnv,
        apiKeys,
        providerSettings,
      }),
      system: `You are a concise title generator. Given a user's message to a coding assistant, generate a short, descriptive title (3-8 words) that captures the essence of what the user wants to build or do. 

Rules:
- Output ONLY the title text, nothing else
- No quotes, no punctuation at the end, no prefixes
- Keep it short and descriptive (3-8 words)
- Focus on the main project/task, not implementation details
- Use title case

Examples:
- User: "Build me a tic tac toe game with react" → "Tic Tac Toe Game"
- User: "Create a landing page for my SaaS product with dark mode and animations" → "SaaS Landing Page"
- User: "Help me fix the login bug where users get stuck in a redirect loop" → "Fix Login Redirect Loop"
- User: "I want a real-time chat application using websockets" → "Real-Time Chat App"
- User: "Make a portfolio website with a blog section" → "Portfolio Website With Blog"`,
      prompt: message.slice(0, 500),
      maxTokens: 30,
    });

    const title = resp.text
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\.+$/, '');

    logger.info(`Generated title: "${title}" for message: "${message.slice(0, 80)}..."`);

    return new Response(JSON.stringify({ title: title || message.slice(0, 57).trim() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Failed to generate title:', error);

    /*
     * Fallback to truncation if AI generation fails — this ensures
     * the chat still gets a title even if the model call errors out.
     */
    return new Response(JSON.stringify({ title: message.slice(0, 57).trim() + (message.length > 57 ? '...' : '') }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
