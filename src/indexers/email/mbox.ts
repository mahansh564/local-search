import fs from 'fs';
import { parseEmail, type Email } from './parser.js';

export interface MboxMessage {
  offset: number;
  email: Email;
}

export function parseMbox(mboxPath: string): MboxMessage[] {
  const content = fs.readFileSync(mboxPath, 'utf-8');
  const messages: MboxMessage[] = [];

  const lines = content.split('\n');
  let currentMessage: string[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line !== 'string') continue;

    if (line.startsWith('From ')) {
      if (currentMessage.length > 0) {
        const messageContent = currentMessage.join('\n');
        messages.push({
          offset,
          email: parseEmail(messageContent),
        });
      }
      offset = i;
      currentMessage = [];
    } else {
      currentMessage.push(line);
    }
  }

  if (currentMessage.length > 0) {
    const messageContent = currentMessage.join('\n');
    messages.push({
      offset,
      email: parseEmail(messageContent),
    });
  }

  return messages;
}