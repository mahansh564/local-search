import fs from 'fs';
import path from 'path';
import { parseEmail, type Email } from './parser.js';

export interface MaildirMessage {
  path: string;
  email: Email;
  flags: string;
}

export function parseMaildir(maildirPath: string): MaildirMessage[] {
  const messages: MaildirMessage[] = [];

  const curDir = path.join(maildirPath, 'cur');
  const newDir = path.join(maildirPath, 'new');

  if (fs.existsSync(curDir)) {
    for (const file of fs.readdirSync(curDir)) {
      const filePath = path.join(curDir, file);
      if (fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const flags = extractFlags(file);
        messages.push({
          path: filePath,
          email: parseEmail(content),
          flags,
        });
      }
    }
  }

  if (fs.existsSync(newDir)) {
    for (const file of fs.readdirSync(newDir)) {
      const filePath = path.join(newDir, file);
      if (fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath, 'utf-8');
        messages.push({
          path: filePath,
          email: parseEmail(content),
          flags: '',
        });
      }
    }
  }

  return messages;
}

function extractFlags(filename: string): string {
  const colonIndex = filename.indexOf(':2,');
  if (colonIndex === -1) return '';
  return filename.substring(colonIndex + 3);
}