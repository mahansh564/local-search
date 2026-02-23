import { test, expect } from 'bun:test';
import { buildMessages, toLangChainMessages } from '../prompts';

test('toLangChainMessages converts prompt messages to LangChain messages', () => {
  const raw = buildMessages([{ path: 'x', content: 'hello' }], 'question');
  const lc = toLangChainMessages(raw);

  expect(lc.length).toBe(2);
  expect(lc[0]?.constructor.name).toBe('SystemMessage');
  expect(lc[1]?.constructor.name).toBe('HumanMessage');
});
