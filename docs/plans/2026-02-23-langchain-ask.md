# LangChain Ask Answer Generation (Stage 2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch `ask` answer generation to LangChain (ChatOllama) while preserving existing prompts, streaming, and error handling.

**Architecture:** Introduce a LangChain adapter for `ask` that converts existing prompt messages to LangChain messages, supports streaming, and uses the same Ollama host/model configuration.

**Tech Stack:** Bun, TypeScript, LangChain JS (`@langchain/ollama`, `@langchain/core`).

---

### Task 1: Add LangChain message conversion helper

**Files:**
- Modify: `/Users/anshulmahajan/Desktop/Projects/local-search/src/llm/prompts.ts`
- Create: `/Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/prompts-langchain.test.ts`

**Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { buildMessages, toLangChainMessages } from '../prompts';

test('toLangChainMessages converts prompt messages to LangChain messages', () => {
  const raw = buildMessages([{ path: 'x', content: 'hello' }], 'question');
  const lc = toLangChainMessages(raw);

  expect(lc.length).toBe(2);
  expect(lc[0]?.constructor.name).toBe('SystemMessage');
  expect(lc[1]?.constructor.name).toBe('HumanMessage');
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/prompts-langchain.test.ts
```

Expected: FAIL (`toLangChainMessages` missing).

**Step 3: Write minimal implementation**

- Add `toLangChainMessages(messages)` in `prompts.ts`:
  - Convert `{role, content}` to `SystemMessage | HumanMessage | AIMessage`.

**Step 4: Run test to verify it passes**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/prompts-langchain.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/prompts.ts \
  /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/prompts-langchain.test.ts
git commit -m "test: add langchain prompt conversion"
```

---

### Task 2: Add LangChain chat helper for ask

**Files:**
- Create: `/Users/anshulmahajan/Desktop/Projects/local-search/src/llm/langchain-chat.ts`
- Create: `/Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/langchain-chat.test.ts`

**Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { streamResponseText } from '../langchain-chat';

test('streamResponseText concatenates stream chunks', async () => {
  async function* fakeStream() {
    yield { content: 'Hello ' };
    yield { content: 'world' };
  }

  const text = await streamResponseText(fakeStream());
  expect(text).toBe('Hello world');
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/langchain-chat.test.ts
```

Expected: FAIL (`streamResponseText` missing).

**Step 3: Write minimal implementation**

- `langchain-chat.ts` exports:
  - `createChatModel(model?: string)` returning `ChatOllama` with `baseUrl: process.env.OLLAMA_HOST`, `temperature: 0`
  - `streamResponseText(stream)` helper to concatenate `chunk.content`

**Step 4: Run test to verify it passes**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/langchain-chat.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/langchain-chat.ts \
  /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/langchain-chat.test.ts
git commit -m "test: add langchain chat helper"
```

---

### Task 3: Switch ask command to LangChain

**Files:**
- Modify: `/Users/anshulmahajan/Desktop/Projects/local-search/src/cli/commands/ask.ts`

**Step 1: Write the failing test**

Add to `/Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/langchain-chat.test.ts`:

```ts
import { toLangChainMessages } from '../prompts';

test('ask uses langchain messages for chat', async () => {
  const messages = toLangChainMessages([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'user' },
  ]);
  expect(messages.length).toBe(2);
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/langchain-chat.test.ts
```

Expected: FAIL if imports missing / messages not exposed.

**Step 3: Write minimal implementation**

- In `ask.ts`:
  - Replace `OllamaClient` usage with `createChatModel`.
  - Use `toLangChainMessages(buildMessages(...))`.
  - For non-stream: `await llm.invoke(messages)` and print `content`.
  - For stream: `for await (const chunk of llm.stream(messages)) process.stdout.write(chunk.content ?? '')`.
  - Keep `checkConnection` using `OllamaClient` or handle errors gracefully if invoke fails.

**Step 4: Run test to verify it passes**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/langchain-chat.test.ts \
  /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/prompts-langchain.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/anshulmahajan/Desktop/Projects/local-search/src/cli/commands/ask.ts \
  /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/langchain-chat.ts \
  /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/prompts.ts \
  /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/langchain-chat.test.ts \
  /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/prompts-langchain.test.ts
git commit -m "feat: move ask generation to langchain"
```

---

### Task 4: Verification

**Step 1: Run targeted tests**

```bash
bun test /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/prompts-langchain.test.ts \
  /Users/anshulmahajan/Desktop/Projects/local-search/src/llm/__tests__/langchain-chat.test.ts
```

Expected: PASS.

**Step 2: Manual smoke check**

```bash
bun run /Users/anshulmahajan/Desktop/Projects/local-search/src/index.ts ask "What is in my TODO note about realtime?" --no-stream
```

Expected: Answer printed, no errors.

---

**Plan complete.**
