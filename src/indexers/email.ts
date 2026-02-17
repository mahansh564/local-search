import { parseMaildir } from './email/maildir.js';
import { parseMbox } from './email/mbox.js';
import fs from 'fs';
import path from 'path';

export interface EmailCollection {
  name: string;
  path: string;
  format: 'maildir' | 'mbox' | 'eml';
}

export interface EmailDocument {
  path: string;
  subject: string;
  from: string;
  to: string[];
  date: Date;
  content: string;
  messageId: string;
}

export class EmailIndexer {
  async indexCollection(collection: EmailCollection): Promise<EmailDocument[]> {
    switch (collection.format) {
      case 'maildir':
        return this.indexMaildir(collection.path);
      case 'mbox':
        return this.indexMbox(collection.path);
      case 'eml':
        return this.indexEmlFiles(collection.path);
      default:
        throw new Error(`Unknown email format: ${collection.format}`);
    }
  }

  private indexMaildir(maildirPath: string): EmailDocument[] {
    const messages = parseMaildir(maildirPath);
    return messages.map(m => ({
      path: m.path,
      subject: m.email.headers.subject,
      from: m.email.headers.from,
      to: m.email.headers.to,
      date: m.email.headers.date,
      content: m.email.body.text || m.email.body.html || '',
      messageId: m.email.headers.messageId,
    }));
  }

  private indexMbox(mboxPath: string): EmailDocument[] {
    const messages = parseMbox(mboxPath);
    return messages.map(m => ({
      path: `${mboxPath}#${m.offset}`,
      subject: m.email.headers.subject,
      from: m.email.headers.from,
      to: m.email.headers.to,
      date: m.email.headers.date,
      content: m.email.body.text || m.email.body.html || '',
      messageId: m.email.headers.messageId,
    }));
  }

  private indexEmlFiles(emlDir: string): EmailDocument[] {
    const { parseEmail } = require('./email/parser.js');
    const documents: EmailDocument[] = [];

    const files = fs.readdirSync(emlDir).filter(f => f.endsWith('.eml'));
    for (const file of files) {
      const filePath = path.join(emlDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const email = parseEmail(content);

      documents.push({
        path: filePath,
        subject: email.headers.subject,
        from: email.headers.from,
        to: email.headers.to,
        date: email.headers.date,
        content: email.body.text || email.body.html || '',
        messageId: email.headers.messageId,
      });
    }

    return documents;
  }
}