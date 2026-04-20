import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

interface Collection {
  name: string;
  path: string;
  type: 'files' | 'email' | 'apple-notes' | 'image';
  glob: string;
  emailFormat?: 'maildir' | 'mbox' | 'eml';
  notesDb?: string;
  visionModel?: string;
}

interface Config {
  database_path: string;
  collections: Collection[];
  search: {
    default_limit: number;
    min_score: number;
    recency_boost: number;
  };
}

const DEFAULT_CONFIG: Config = {
  database_path: '~/.donut/index.sqlite',
  collections: [],
  search: {
    default_limit: 10,
    min_score: 0.1,
    recency_boost: 0.2,
  },
};

export class ConfigManager {
  private configPath: string;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, 'config.yaml');
  }

  async init(): Promise<void> {
    if (!fs.existsSync(this.configPath)) {
      await this.save(DEFAULT_CONFIG);
    }
  }

  async load(): Promise<Config> {
    if (!fs.existsSync(this.configPath)) {
      return DEFAULT_CONFIG;
    }
    
    const content = fs.readFileSync(this.configPath, 'utf-8');
    return yaml.parse(content) as Config;
  }

  async save(config: Config): Promise<void> {
    fs.writeFileSync(this.configPath, yaml.stringify(config));
  }

  async getCollections(): Promise<Collection[]> {
    const config = await this.load();
    return config.collections || [];
  }

  async addCollection(collection: Collection): Promise<void> {
    const config = await this.load();
    
    const existingIndex = config.collections.findIndex(c => c.name === collection.name);
    if (existingIndex >= 0) {
      config.collections[existingIndex] = collection;
    } else {
      config.collections.push(collection);
    }
    
    await this.save(config);
  }

  async removeCollection(name: string): Promise<void> {
    const config = await this.load();
    config.collections = config.collections.filter(c => c.name !== name);
    await this.save(config);
  }
}
