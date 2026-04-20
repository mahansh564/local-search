import chalk from 'chalk';
import { Database } from 'bun:sqlite';
import { RAGPipeline } from '../../search/pipeline.js';
import { OllamaClient } from '../../llm/ollama.js';
import { buildMessages, toLangChainMessages } from '../../llm/prompts.js';
import { createChatModel, streamChat } from '../../llm/langchain-chat.js';
import { donutDatabasePath } from '../../utils/app-paths.js';
import path from 'path';

interface AskOptions {
  limit: string;
  model?: string;
  'no-stream'?: boolean;
}

function extractTextContent(rawContent: string): string {
  try {
    const parsed = JSON.parse(rawContent);
    if (parsed.content && Array.isArray(parsed.content)) {
      return parsed.content
        .map((block: any) => block.text || '')
        .join('\n')
        .trim();
    }
    if (typeof parsed === 'string') {
      return parsed;
    }
    return rawContent;
  } catch {
    return rawContent;
  }
}

export async function askCommand(question: string, options: AskOptions) {
  const dbPath = donutDatabasePath();
  
  const db = new Database(dbPath);
  const pipeline = new RAGPipeline(db, {
    enableReranking: true,
    enableMMR: false,
    mmrLambda: 0.5,
    enableQueryExpansion: false,
  });

  const limit = parseInt(options.limit) || 5;
  
  console.log(chalk.blue(`🤔 Question: "${question}"`));
  console.log(chalk.gray('Searching for relevant context...\n'));

  try {
    await pipeline.initialize();

    const results = await pipeline.search(question, {
      limit,
      enableMMR: false,
      enableQueryExpansion: false,
      includeFullDocument: true,
    });

    if (results.length === 0) {
      console.log(chalk.yellow('No documents found. Please index some documents first using:'));
      console.log(chalk.gray('  bun run src/index.ts add <path>'));
      console.log(chalk.gray('  bun run src/index.ts index'));
      process.exit(1);
    }

    const documents = results.map((r: any) => ({
      title: r.title || r.path.split('/').pop() || 'Unknown',
      path: r.path,
      content: extractTextContent(r.fullContent || r.content),
    }));

    console.log(chalk.gray(`Found ${results.length} relevant documents.\n`));
    console.log(chalk.gray('Generating answer...\n'));

    const ollama = new OllamaClient({
      model: options.model,
    });

    const isConnected = await ollama.checkConnection();
    if (!isConnected) {
      console.log(chalk.red('✗ Cannot connect to Ollama. Please ensure Ollama is running:'));
      console.log(chalk.gray('  ollama serve'));
      console.log(chalk.gray('\nOr set a custom host:'));
      console.log(chalk.gray('  export OLLAMA_HOST=http://localhost:11434'));
      process.exit(1);
    }

    const messages = toLangChainMessages(buildMessages(documents, question));
    const llm = createChatModel(options.model);

    if (options['no-stream']) {
      const response = await llm.invoke(messages);
      const content = typeof response === 'string' ? response : response.content;
      console.log(chalk.white(content || ''));
    } else {
      process.stdout.write(chalk.white(''));
      
      for await (const chunk of streamChat(llm, messages)) {
        if (chunk?.content) {
          process.stdout.write(chunk.content);
        }
      }
      process.stdout.write('\n');
    }

    console.log(chalk.gray('\n---'));
    console.log(chalk.gray('Sources:'));
    for (const doc of documents) {
      const source = doc.title || doc.path.split('/').pop() || 'Unknown';
      console.log(chalk.gray(`  • ${source}`));
    }
  } catch (error) {
    console.error(chalk.red(`✗ Error: ${error}`));
    process.exit(1);
  }
}
