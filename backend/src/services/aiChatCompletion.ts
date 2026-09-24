/**
 * A generic OpenAI-compatible chat-completion call — one call path reused by
 * every AI-backed feature regardless of which provider is configured for it
 * (plan.md §610). Anthropic, Google Gemini and Groq each publish an
 * OpenAI-compatible `/chat/completions` endpoint that accepts a plain bearer
 * token, so there is nothing provider-specific left here once the base URL,
 * key and model are known — no per-provider SDK.
 */

export class AiChatCompletionError extends Error {}

export interface ChatCompletionRequest {
  /** OpenAI-compatible base URL, trailing slash — "chat/completions" is appended. */
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

const REQUEST_TIMEOUT_MS = 60_000;

export async function callOpenAiCompatChat(req: ChatCompletionRequest): Promise<string> {
  const url = new URL('chat/completions', req.baseUrl).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AiChatCompletionError(`Unable to reach the AI provider: ${(error as Error).message}`);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (body as { error?: { message?: string } } | null)?.error?.message || `HTTP ${response.status}`;
    throw new AiChatCompletionError(`AI provider request failed: ${detail}`);
  }

  const text = (body as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new AiChatCompletionError('AI provider returned an empty response.');
  }
  return text.trim();
}
