export interface ContentMetadata {
  links: string[];
  headings: string[];
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
  description?: string;
}

export interface DocumentMetadata extends ContentMetadata {
  source: 'apple-notes' | 'files' | 'email' | 'image';
  imageMetadata?: ImageMetadata;
}
const MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/‚Äô/g, "'"],
  [/‚Äì/g, '-'],
  [/‚Äî/g, '—'],
  [/‚Äú/g, '"'],
  [/‚Äù/g, '"'],
  [/‚Ä¶/g, '…'],
  [/üíô/g, '😀'],
];

export function normalizeContent(input: string): string {
  let text = input.replace(/\r\n/g, '\n');

  for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\t/g, ' ');
  text = text.replace(/[ \t]+/g, ' ');

  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

export function extractMetadata(content: string): ContentMetadata {
  const headings: string[] = [];
  const links: string[] = [];

  const headingMatches = content.matchAll(/^#{1,6}\s+(.+)$/gm);
  for (const match of headingMatches) {
    const heading = match[1]?.trim();
    if (heading) headings.push(heading);
  }

  const linkMatches = content.matchAll(/https?:\/\/[^\s)]+/g);
  for (const match of linkMatches) {
    const link = match[0];
    if (link) links.push(link);
  }

  return {
    headings: Array.from(new Set(headings)),
    links: Array.from(new Set(links)),
  };
}

export function buildDocumentMetadata(
  source: DocumentMetadata['source'],
  content: string
): DocumentMetadata {
  const extracted = extractMetadata(content);
  return {
    source,
    links: extracted.links,
    headings: extracted.headings,
  };
}
