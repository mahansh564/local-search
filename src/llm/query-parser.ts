import { type FilterGroup, type MetadataFilter } from '../search/filters.js';
import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

export type SourceType = 'apple-notes' | 'files' | 'email';

export interface QueryParseResult {
  keywords: string[];
  sources: SourceType[];
  confidence: {
    keywords: number;
    sources: number;
  };
}

const SOURCE_TYPES: SourceType[] = ['apple-notes', 'files', 'email'];

const queryParseSchema = z.object({
  keywords: z.array(z.string()).default([]),
  sources: z.array(z.enum(SOURCE_TYPES)).default([]),
  confidence: z
    .object({
      keywords: z.number().min(0).max(1).default(0),
      sources: z.number().min(0).max(1).default(0),
    })
    .default({ keywords: 0, sources: 0 }),
});

export function normalizeQueryParseResult(
  input: Partial<QueryParseResult>
): QueryParseResult {
  const keywords = Array.isArray(input.keywords) ? input.keywords.filter(Boolean) : [];
  const sources = Array.isArray(input.sources)
    ? input.sources.filter((s): s is SourceType => SOURCE_TYPES.includes(s as SourceType))
    : [];

  const clamp = (value: number | undefined) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    return Math.min(1, Math.max(0, value));
  };

  return {
    keywords,
    sources,
    confidence: {
      keywords: clamp(input.confidence?.keywords),
      sources: clamp(input.confidence?.sources),
    },
  };
}

export function buildBm25Query(original: string, parsed: QueryParseResult): string {
  if (parsed.keywords.length === 0) return original;
  if (parsed.confidence.keywords < 0.5) return original;
  return parsed.keywords.join(' ');
}

export function buildSourceFilter(
  sources: SourceType[]
): FilterGroup | undefined {
  if (sources.length === 0) return undefined;

  return {
    operator: 'or',
    filters: sources.map((source) => ({
      field: 'source',
      operator: 'eq',
      value: source,
    })),
  };
}

type FilterInput = FilterGroup | MetadataFilter | undefined;

export function mergeFilters(
  existing: FilterInput,
  extra: FilterGroup | undefined
): FilterGroup | undefined {
  if (!existing) return extra;
  if (!extra) return existing;
  return {
    operator: 'and',
    filters: [existing, extra],
  };
}

export async function parseQueryWithLLM(
  query: string,
  options: {
    model?: string;
    llm?: { invoke: (input: any) => Promise<any> };
  } = {}
): Promise<QueryParseResult> {
  try {
    const llm =
      options.llm ||
      new ChatOllama({
        model: options.model || process.env.QUERY_PARSER_MODEL || 'llama3.2:1b',
        temperature: 0,
        format: 'json',
        baseUrl: process.env.OLLAMA_HOST,
      });

    const system = new SystemMessage(
      [
        'You extract search keywords and sources from a user query.',
        `Allowed sources: ${SOURCE_TYPES.join(', ')}.`,
        'Return ONLY JSON with shape:',
        '{"keywords":["..."],"sources":["..."],"confidence":{"keywords":0-1,"sources":0-1}}',
        'If no sources are specified, return an empty sources array.',
      ].join(' ')
    );

    const response = await llm.invoke([system, new HumanMessage(query)]);
    const content =
      typeof response === 'string'
        ? response
        : (response as { content?: string }).content ?? '';

    const jsonText = extractJson(content);
    const parsed = jsonText ? JSON.parse(jsonText) : {};
    const result = queryParseSchema.safeParse(parsed);

    return normalizeQueryParseResult(result.success ? result.data : {});
  } catch {
    return normalizeQueryParseResult({});
  }
}

function extractJson(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}
