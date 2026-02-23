import { ChatOllama } from '@langchain/ollama';

export function createChatModel(model?: string) {
  return new ChatOllama({
    model: model || process.env.OLLAMA_MODEL || 'llama3.1',
    temperature: 0,
    baseUrl: process.env.OLLAMA_HOST,
  });
}

export async function streamResponseText(stream: AsyncIterable<{ content?: string }>): Promise<string> {
  let output = '';
  for await (const chunk of stream) {
    if (typeof chunk?.content === 'string') {
      output += chunk.content;
    }
  }
  return output;
}

export async function* streamChat(
  llm: { stream?: (messages: any[]) => Promise<AsyncIterable<any>> | AsyncIterable<any>; invoke: (messages: any[]) => Promise<any> },
  messages: any[]
): AsyncGenerator<{ content?: string }, void, unknown> {
  if (typeof llm.stream === 'function') {
    const streamResult = await llm.stream(messages);
    if (streamResult && typeof (streamResult as any)[Symbol.asyncIterator] === 'function') {
      for await (const chunk of streamResult as AsyncIterable<any>) {
        if (typeof chunk === 'string') {
          yield { content: chunk };
        } else {
          yield chunk as { content?: string };
        }
      }
      return;
    }
  }

  const response = await llm.invoke(messages);
  if (typeof response === 'string') {
    yield { content: response };
    return;
  }
  yield { content: response?.content ?? '' };
}
