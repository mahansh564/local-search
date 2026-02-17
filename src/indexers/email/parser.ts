export interface EmailHeaders {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: Date;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
}

export interface Email {
  headers: EmailHeaders;
  body: {
    text?: string;
    html?: string;
  };
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

export function parseEmail(content: string): Email {
  const lines = content.split('\n');
  const headers: Partial<EmailHeaders> = {};
  const headerLines: string[] = [];
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line !== 'string') continue;

    if (line === '' || line === '\r') {
      bodyStart = i + 1;
      break;
    }

    if (line.startsWith(' ') || line.startsWith('\t')) {
      const lastIndex = headerLines.length - 1;
      if (lastIndex >= 0) {
        headerLines[lastIndex] = (headerLines[lastIndex] ?? '') + ' ' + line.trim();
      }
    } else {
      headerLines.push(line);
    }
  }

  for (const line of headerLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const name = line.substring(0, colonIndex).toLowerCase();
    const value = line.substring(colonIndex + 1).trim();

    switch (name) {
      case 'from':
        headers.from = parseAddress(value);
        break;
      case 'to':
        headers.to = parseAddressList(value);
        break;
      case 'cc':
        headers.cc = parseAddressList(value);
        break;
      case 'subject':
        headers.subject = decodeHeader(value);
        break;
      case 'date':
        headers.date = new Date(value);
        break;
      case 'message-id':
        headers.messageId = value.replace(/[<>]/g, '');
        break;
      case 'in-reply-to':
        headers.inReplyTo = value.replace(/[<>]/g, '');
        break;
      case 'references':
        headers.references = value.split(/\s+/).map(r => r.replace(/[<>]/g, ''));
        break;
    }
  }

  const bodyContent = lines.slice(bodyStart).join('\n');
  const { text, html, attachments } = parseBody(bodyContent);

  return {
    headers: {
      from: headers.from || 'unknown',
      to: headers.to || [],
      cc: headers.cc || [],
      subject: headers.subject || '(no subject)',
      date: headers.date || new Date(),
      messageId: headers.messageId || '',
      inReplyTo: headers.inReplyTo,
      references: headers.references,
    },
    body: { text, html },
    attachments,
  };
}

function parseAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return match?.[1] ?? value;
}

function parseAddressList(value: string): string[] {
  return value.split(',').map(a => parseAddress(a.trim()));
}

function decodeHeader(value: string): string {
  const match = value.match(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/i);
  if (!match) return value;

  const encoding = match[2]?.toUpperCase();
  const encoded = match[3];

  if (!encoded) return value;

  if (encoding === 'B') {
    const decoded = Buffer.from(encoded, 'base64').toString();
    return decoded;
  } else if (encoding === 'Q') {
    const decoded = encoded
      .replace(/=/g, '%')
      .replace(/_/, ' ');
    return decodeURIComponent(decoded);
  }

  return value;
}

function parseBody(content: string): { text?: string; html?: string; attachments: Email['attachments'] } {
  const attachments: Email['attachments'] = [];

  if (content.includes('Content-Type: multipart/')) {
    const boundaryMatch = content.match(/boundary="?([^"\s]+)"?/);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = content.split('--' + boundary);

      let text: string | undefined;
      let html: string | undefined;

      for (const part of parts) {
        if (part.includes('Content-Type: text/plain')) {
          text = extractPartContent(part);
        } else if (part.includes('Content-Type: text/html')) {
          html = extractPartContent(part);
        } else if (part.includes('Content-Disposition: attachment')) {
          const filenameMatch = part.match(/filename="?([^"\s]+)"?/);
          const typeMatch = part.match(/Content-Type:\s*([^;\s]+)/);
          if (filenameMatch?.[1]) {
            attachments.push({
              filename: filenameMatch[1],
              contentType: typeMatch?.[1] ?? 'application/octet-stream',
              size: part.length,
            });
          }
        }
      }

      return { text, html, attachments };
    }
  }

  if (content.includes('Content-Type: text/html')) {
    return { html: extractPartContent(content), attachments };
  }

  return { text: content.trim(), attachments };
}

function extractPartContent(part: string): string {
  const headerEnd = part.indexOf('\n\n');
  if (headerEnd === -1) return part.trim();

  let content = part.substring(headerEnd + 2).trim();

  if (part.includes('Content-Transfer-Encoding: base64')) {
    try {
      content = Buffer.from(content.replace(/\s/g, ''), 'base64').toString();
    } catch {
      // Keep original if decoding fails
    }
  } else if (part.includes('Content-Transfer-Encoding: quoted-printable')) {
    content = content
      .replace(/=\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  return content;
}