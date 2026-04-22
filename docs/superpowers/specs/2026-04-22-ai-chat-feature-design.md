# AI Chat Feature — Design Spec

**Date:** 2026-04-22  
**Status:** Approved

## Overview

Add AI-powered chat assistance to MongoMacApp, allowing users to ask questions about their queries, results, and database schema. The AI has automatic context awareness of the current editor tab, connection, and results.

**Key Features:**
- Floating button triggers side panel chat interface
- Configurable OpenAI-compatible API (works with OpenAI, Anthropic, local models, etc.)
- Per-tab conversation history (isolated, lost when tab closes)
- Rich automatic context: editor content, results, connection info, schema, indexes
- Extensible provider architecture for future AI backends
- Streaming or complete response modes

---

## UI Design

### 1. Floating Button
- **Location:** Bottom-right corner, absolutely positioned at `bottom: 24px, right: 24px`
- **Appearance:** 48×48px circular button with gradient background (`#4ec9b0` → `#3ea88f`) and ✨ icon
- **Behavior:** Toggles AI panel visibility
- **States:** Hover animation, always visible (except when settings panel is open)

### 2. AI Chat Panel (Side Panel - Docked Right)
- **Layout:** Slides in from right edge when opened
- **Dimensions:** 
  - Default width: 380px
  - Min width: 280px
  - Max width: 600px
  - Full height of main content area
- **Resizable:** Drag handle on left edge (reuses existing `SplitHandle` pattern)

**Panel Structure:**
```
┌─────────────────────────────────┐
│ ✨ AI Assistant            [×]  │ ← Header (36px)
├─────────────────────────────────┤
│                                 │
│  [AI bubble]                    │
│  Hello! How can I help?         │
│                                 │
│              [User bubble]      │
│              Explain this query │
│                                 │ ← Messages (flex: 1, scrollable)
│  [AI bubble]                    │
│  This query finds documents...  │
│                                 │
├─────────────────────────────────┤
│ [Text input area]               │
│ ┌─────────────────────┬───────┐ │
│ │ Ask anything...     │ Send  │ │ ← Input area (auto-height)
│ └─────────────────────┴───────┘ │
│ Clear context                   │
└─────────────────────────────────┘
```

### 3. AI Settings Section
Added to Settings view (registered in `settings/registry.ts`):

**Fields:**
- **Base URL** (text input)
  - Placeholder: `https://api.openai.com/v1`
  - For OpenAI-compatible APIs
- **API Token** (password input, masked)
  - Securely stored using Tauri keychain API
- **Model** (text input)
  - Placeholder: `gpt-4o`
  - Model name passed to API
- **Streaming** (toggle switch)
  - Options: "Stream responses" / "Wait for complete"
  - Default: true (streaming enabled)

**Test Connection Button:** Validates credentials with a simple API call

---

## Architecture

### Component Hierarchy

```
App.tsx
├── AIFloatingButton (when !settingsOpen)
│   └── toggles aiPanelOpen in useAIStore
├── AIChatPanel (when aiPanelOpen)
│   ├── Header (close button)
│   ├── Messages area
│   │   └── AIMessageBubble[] (user/assistant messages)
│   └── Input area
│       ├── Textarea (auto-grow)
│       ├── Send button
│       └── Clear context button
└── SettingsView
    └── AISettingsSection
```

### Service Layer Architecture

```
┌──────────────────────────────────────┐
│           UI Layer                   │
│  AIFloatingButton, AIChatPanel       │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│        Service Layer                 │
│  ┌────────────────────────────────┐  │
│  │  AIService                     │  │
│  │  - orchestrates chat requests  │  │
│  │  - manages streaming           │  │
│  └────────┬──────────────┬────────┘  │
│           │              │            │
│  ┌────────▼────────┐ ┌──▼─────────┐  │
│  │ ContextCollector│ │ChatHistory │  │
│  │ - gathers context│ │Manager     │  │
│  └─────────────────┘ └────────────┘  │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│       Provider Layer                 │
│  ┌────────────────────────────────┐  │
│  │  AIProvider (interface)        │  │
│  │  - chat()                      │  │
│  │  - streamChat()                │  │
│  └────────┬───────────────────────┘  │
│           │                           │
│  ┌────────▼───────────────────────┐  │
│  │ OpenAICompatibleProvider       │  │
│  │ - uses openai npm package      │  │
│  │ - configurable baseURL         │  │
│  └────────────────────────────────┘  │
│                                       │
│  ┌────────────────────────────────┐  │
│  │ ProviderRegistry               │  │
│  │ - register(name, provider)     │  │
│  │ - get(name)                    │  │
│  └────────────────────────────────┘  │
└───────────────────────────────────────┘
```

### Provider Abstraction (Strategy Pattern)

**AIProvider Interface:**
```typescript
interface AIProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncGenerator<string>;
}

interface ChatRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  model: string;
  temperature?: number;
}

interface ChatResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}
```

**Why this pattern:**
- Adding new providers requires zero changes to existing code
- Just implement `AIProvider` interface and register
- Future: `AnthropicProvider`, `GoogleProvider`, `LocalModelProvider`, etc.

---

## Data Flow

### Message Send Flow

```
User types message and clicks Send
  ↓
1. ContextCollector gathers tab context:
   - EditorContextCollector → current script/query
   - ResultsContextCollector → results panel data
   - ConnectionContextCollector → active connection/database
   - SchemaContextCollector → schema/indexes (if viewing collection)
  ↓
2. Build full message array:
   - System message (includes context)
   - Chat history from ChatHistoryManager
   - New user message
  ↓
3. AIService calls provider:
   - Read streaming preference from settings
   - Call provider.streamChat() or provider.chat()
  ↓
4. Response handling:
   - Streaming: word-by-word updates in UI
   - Complete: show spinner, then full response
  ↓
5. ChatHistoryManager appends to tab's history
  ↓
6. UI updates with new message
```

### Tab Context Structure

```typescript
interface TabContext {
  editorContent: string;          // Current script/query text
  results: any[];                 // Query results from results panel
  connectionName: string;         // Active connection
  database: string;               // Active database
  collectionName?: string;        // If browsing a collection
  indexes?: IndexInfo[];          // Collection indexes
  schema?: SchemaInfo;            // Inferred schema from results
}
```

**Context Injection:**
System message format:
```
You are an AI assistant helping with MongoDB queries in MongoMacApp.

Current Context:
- Connection: dev-local
- Database: mydb
- Collection: users

Editor Content:
```
db.users.aggregate([
  { $match: { status: "active" } }
])
```

Query Results (first 5 documents):
[... results data ...]

Collection Indexes:
- _id_ (unique)
- email_1 (unique)
- status_1

Schema:
- _id: ObjectId
- email: string
- status: string
- createdAt: Date
```

---

## State Management

### AIStore (Zustand)

```typescript
interface AIState {
  // Panel visibility
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  
  // Per-tab chat histories (keyed by tab ID)
  chatHistories: Map<string, ChatMessage[]>;
  addMessage: (tabId: string, message: ChatMessage) => void;
  clearHistory: (tabId: string) => void;
  
  // Loading states per tab
  loadingStates: Map<string, boolean>;
  setLoading: (tabId: string, loading: boolean) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  error?: string;  // For failed messages
}
```

### Settings Storage (extends useSettingsStore)

```typescript
interface AIConfig {
  baseUrl: string;           // default: 'https://api.openai.com/v1'
  apiToken: string;          // stored in Tauri keychain
  model: string;             // default: 'gpt-4'
  streaming: boolean;        // default: true
}

// Added to existing settings store
settings: {
  ...existing,
  aiConfig: AIConfig
}
```

**Storage Details:**
- Settings persisted same as other app settings
- API token stored securely via Tauri keychain API (similar to MongoDB passwords)
- Chat histories in-memory only (not persisted)

---

## Per-Tab Context Isolation

**Key Requirement:** Each editor tab maintains its own isolated AI conversation.

**Implementation:**
1. Each editor tab has a unique ID (already exists in tab system)
2. `useAIStore.chatHistories` is a Map keyed by tab ID
3. When user switches tabs:
   - AI panel shows conversation for current tab
   - Previous tab's conversation preserved in memory
4. When tab closes:
   - Its chat history is deleted from the Map
   - Fresh start if a new tab is opened

**"Clear Context" Button:**
- Clears the chat history for the current tab only
- Next message starts with no prior conversation
- Context (editor, results, etc.) still included in system message

---

## Error Handling

### Error Types & Recovery

| Error Type | Display | Action |
|------------|---------|--------|
| Network/timeout | "Connection failed. Check your network." | Edit & Retry button |
| 401/403 Auth | "Invalid API token. Check settings." | Edit & Retry + Settings link |
| 429 Rate limit | "Rate limit exceeded. Retry in X seconds." | Edit & Retry (auto-delay) |
| 4xx/5xx API | Show error message from API response | Edit & Retry button |
| Streaming interrupted | "Connection lost. Response may be incomplete." | Edit & Retry button |

**"Edit & Retry" Flow:**
1. Failed message remains in chat with error indicator (red border)
2. "Edit & Retry" button pre-fills input with failed message
3. User can modify and resend
4. New attempt uses current context (not original context)

---

## Implementation Details

### File Structure

```
src/
├── components/ai/
│   ├── AIFloatingButton.tsx       # Floating button component
│   ├── AIChatPanel.tsx            # Main chat panel
│   └── AIMessageBubble.tsx        # Individual message rendering
├── services/ai/
│   ├── AIService.ts               # Main service orchestrator
│   ├── ContextCollector.ts        # Gathers tab context
│   ├── ChatHistoryManager.ts      # Per-tab history management
│   └── providers/
│       ├── AIProvider.ts          # Interface definition
│       ├── OpenAICompatibleProvider.ts  # Implementation
│       └── ProviderRegistry.ts    # Provider registry
├── store/ai.ts                    # Zustand store
└── settings/sections/AISettingsSection.tsx  # Settings UI
```

### Context Collector Implementation

Each collector is independent and returns formatted string:

```typescript
interface ContextCollector {
  collect(): Promise<string>;
}

class EditorContextCollector implements ContextCollector {
  async collect(): Promise<string> {
    const activeTab = useEditorStore.getState().activeTab;
    if (!activeTab?.content) return '';
    return `Editor Content:\n\`\`\`\n${activeTab.content}\n\`\`\`\n`;
  }
}

class ResultsContextCollector implements ContextCollector {
  async collect(): Promise<string> {
    const results = useResultsStore.getState().currentResults;
    if (!results?.length) return '';
    const preview = results.slice(0, 5);  // First 5 docs
    return `Query Results (first 5):\n${JSON.stringify(preview, null, 2)}\n`;
  }
}

// SchemaContextCollector, ConnectionContextCollector follow same pattern
```

**ContextCollector orchestrator:**
```typescript
class ContextCollector {
  private collectors: ContextCollector[];
  
  async collectAll(): Promise<string> {
    const parts = await Promise.all(
      this.collectors.map(c => c.collect())
    );
    return parts.filter(p => p).join('\n');
  }
}
```

### OpenAICompatibleProvider Implementation

```typescript
import OpenAI from 'openai';

class OpenAICompatibleProvider implements AIProvider {
  private client: OpenAI;
  
  constructor(config: AIConfig) {
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiToken,
    });
  }
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
    });
    
    return {
      content: response.choices[0].message.content,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
      },
    };
  }
  
  async *streamChat(request: ChatRequest): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages,
      stream: true,
    });
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }
}
```

---

## Testing Strategy

### Unit Tests
- Context collectors (mock stores)
- ChatHistoryManager (add, clear, get)
- ProviderRegistry (register, get)
- AIService (mock provider)

### Integration Tests
- AIService + mock provider → verify message flow
- Context collection → verify all sources gathered
- Streaming vs complete response modes

### Manual Testing Scenarios
1. **Different API configs:** OpenAI, Anthropic, local models (Ollama)
2. **Error scenarios:** invalid token, network failure, rate limits
3. **Streaming:** word-by-word display, interruption handling
4. **Tab isolation:** switch tabs during conversation, verify history isolation
5. **Context accuracy:** verify editor/results/schema correctly included
6. **Edge cases:**
   - Empty editor
   - No results
   - Very long responses
   - Rapid messages
   - Tab close during streaming

---

## Extensibility Notes

### Adding a New AI Provider

To add a new provider (e.g., Anthropic native API, Google Gemini):

1. **Create provider class:**
   ```typescript
   // services/ai/providers/AnthropicProvider.ts
   class AnthropicProvider implements AIProvider {
     async chat(request: ChatRequest): Promise<ChatResponse> { ... }
     async *streamChat(request: ChatRequest): AsyncGenerator<string> { ... }
   }
   ```

2. **Register in registry:**
   ```typescript
   // services/ai/providers/ProviderRegistry.ts
   registry.register('anthropic', new AnthropicProvider());
   ```

3. **No other changes needed** — UI, service layer, context collectors remain untouched

### Adding a New Context Collector

To add new context source (e.g., git history, performance metrics):

1. **Create collector class:**
   ```typescript
   // services/ai/context/GitHistoryCollector.ts
   class GitHistoryCollector implements ContextCollector {
     async collect(): Promise<string> {
       // Fetch recent commits for current file
       return `Recent Changes:\n${commits}`;
     }
   }
   ```

2. **Register in ContextCollector:**
   ```typescript
   const collector = new ContextCollector([
     new EditorContextCollector(),
     new ResultsContextCollector(),
     new GitHistoryCollector(),  // New collector
   ]);
   ```

---

## Future Enhancements (Out of Scope for v1)

**Not implementing now, but designed to support:**
- Panel width persistence across sessions
- AI response actions (insert into editor, run as query, save to file)
- Conversation export (save chat history to file)
- Multiple provider selection UI (dropdown to choose provider)
- Token usage tracking and cost estimation
- Custom system prompts per connection
- AI-powered query suggestions
- Response caching for identical questions

---

## Dependencies

**New npm packages:**
- `openai` — Official OpenAI SDK (supports any OpenAI-compatible API)

**Existing dependencies used:**
- `zustand` — State management
- `react-resizable-panels` — For resize handle (or custom implementation)
- Tauri keychain API — Secure token storage

---

## Summary

This design provides:
✅ Floating button + side panel UI with resize  
✅ OpenAI-compatible API configuration  
✅ Per-tab isolated conversations  
✅ Rich automatic context (editor, results, connection, schema, indexes)  
✅ Extensible provider architecture (Strategy Pattern)  
✅ Streaming and complete response modes  
✅ Error recovery with Edit & Retry  
✅ Clean separation of concerns (UI → Service → Provider)  
✅ Zero persisted chat history (in-memory only)

The architecture is designed for extensibility without over-engineering — adding new providers or context sources requires creating new classes, not modifying existing code.
