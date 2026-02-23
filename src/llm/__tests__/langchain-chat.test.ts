import { test, expect } from 'bun:test';
import { streamResponseText, streamChat } from '../langchain-chat';

test('streamResponseText concatenates stream chunks', async () => {
  async function* fakeStream() {
    yield { content: 'Hello ' };
    yield { content: 'world' };
  }

  const text = await streamResponseText(fakeStream());
  expect(text).toBe('Hello world');
});

test('streamChat falls back to invoke when stream is unavailable', async () => {
  const llm = {
    invoke: async () => ({ content: 'fallback response' }),
  };

  const output = await streamResponseText(streamChat(llm as any, []));
  expect(output).toBe('fallback response');
});

test('streamChat awaits async stream results', async () => {
  const llm = {
    stream: async () =>
      (async function* () {
        yield { content: 'streamed ' };
        yield { content: 'response' };
      })(),
    invoke: async () => ({ content: 'fallback response' }),
  };

  const output = await streamResponseText(streamChat(llm as any, []));
  expect(output).toBe('streamed response');
});
