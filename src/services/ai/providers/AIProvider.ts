/**
 * Core AI provider abstraction (Strategy Pattern).
 *
 * To add a new AI backend (e.g. Anthropic native, Google, Ollama, etc.),
 * implement this interface and register the implementation with
 * `providerRegistry` (see ProviderRegistry.ts). No other layer needs to change.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResponse {
  content: string;
  usage?: ChatUsage;
}

/**
 * Provider-agnostic configuration passed to provider constructors.
 * Matches the AIConfig stored in the settings layer.
 */
export interface AIConfig {
  baseUrl: string;
  apiToken: string;
  model: string;
  streaming: boolean;
}

/**
 * Implement this interface to add a new AI provider variant.
 * Register the implementation in `ProviderRegistry.ts`.
 *
 * Both methods accept an optional AbortSignal so callers can cancel an
 * in-flight request (e.g. user closes the chat panel during streaming).
 * Implementations should forward the signal to their underlying HTTP client
 * and surface the abort as a rejected promise / thrown AbortError.
 */
export interface AIProvider {
  /** Non-streaming chat completion. Returns the full response at once. */
  chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  /** Streaming chat completion. Yields content chunks as they arrive. */
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<string>;
  /**
   * Tool-calling completion for the agent loop. Returns the model's text and
   * any tool calls. Throws ToolsUnsupportedError when the backend rejects tools.
   */
  chatWithTools(request: ToolChatRequest, tools: ToolDef[], signal?: AbortSignal): Promise<ToolChatResponse>;
}

/** JSON-schema tool definition passed to the model. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool invocation the model requested. `arguments` is parsed JSON. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Superset of ChatMessage for the tool loop (adds tool results + tool_calls). */
export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ToolChatRequest {
  messages: AgentMessage[];
  model: string;
  temperature?: number;
}

export interface ToolChatResponse {
  content: string;
  toolCalls: ToolCall[];
}

/** Thrown when the configured model/endpoint does not support tool calling. */
export class ToolsUnsupportedError extends Error {
  constructor(message = 'This model does not support tool calling') {
    super(message);
    this.name = 'ToolsUnsupportedError';
  }
}
