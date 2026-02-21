export interface DocumentContext {
  title?: string;
  path: string;
  content: string;
}

export function formatContext(documents: DocumentContext[]): string {
  if (documents.length === 0) {
    return 'No relevant documents found.';
  }

  return documents
    .map((doc, i) => {
      const source = doc.title || doc.path.split('/').pop() || 'Unknown';
      return `[Source: ${source}]\n${doc.content}`;
    })
    .join('\n\n---\n\n');
}

export function buildRagPrompt(documents: DocumentContext[], question: string): string {
  const context = formatContext(documents);
  
  const systemPrompt = `You are a helpful AI assistant that answers questions based on the provided context from documents.
- Answer ONLY based on the provided context
- If the context doesn't contain enough information to answer the question, say "I don't have enough information to answer that question based on the available documents."
- Be concise and accurate
- Always cite sources using the [Source: filename] notation when referring to specific documents`;

  const userPrompt = `Context:
${context}

---

Question: ${question}

Answer:`;

  return `${systemPrompt}

${userPrompt}`;
}

export function buildMessages(documents: DocumentContext[], question: string): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const context = formatContext(documents);

  return [
    {
      role: 'system',
      content: `You are a helpful AI assistant that answers questions based on the provided context from documents.
- Answer ONLY based on the provided context
- If the context doesn't contain enough information to answer the question, say "I don't have enough information to answer that question based on the available documents."
- Be concise and accurate
- Always cite sources using the [Source: filename] notation when referring to specific documents`
    },
    {
      role: 'user',
      content: `Context:
${context}

---

Question: ${question}

Answer:`
    }
  ];
}
