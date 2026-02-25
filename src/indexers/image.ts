import fs from 'fs';
import path from 'path';

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
}

export interface ImageDescription {
  description: string;
  metadata: ImageMetadata;
  imagePath: string;
}

export interface VisionModelConfig {
  host?: string;
  model?: string;
  timeout?: number;
}

// Prompt templates for different image types
const PROMPT_TEMPLATES = {
  general: `Analyze this image and provide a detailed description suitable for semantic search indexing.

Include:
- Main subjects/objects visible
- Scene/setting/environment
- Colors and visual style
- Any text visible (transcribe it)
- Actions or activities depicted
- Overall mood/atmosphere

Be specific but concise. Aim for 2-4 sentences that capture the essential searchable elements.`,

  document: `Analyze this document image for semantic search indexing.

Provide:
1. Document type (receipt, invoice, letter, form, article, etc.)
2. All visible text content (transcribe accurately)
3. Layout structure (headers, sections, tables, lists)
4. Any logos, signatures, or graphical elements
5. Key information snippets (dates, amounts, names, addresses)

Be thorough with text transcription as it's critical for searchability.`,

  screenshot: `Analyze this screenshot for semantic search indexing.

Describe:
1. Application/website name if visible
2. UI elements present (menus, buttons, dialogs, forms)
3. Main content area and what's displayed
4. Any visible text content
5. Color scheme and design style
6. What the user might be doing

Focus on searchable UI elements and content.`,

  photo: `Analyze this photograph for semantic search indexing.

Describe:
1. Main subject(s) - people, animals, objects
2. Setting/location (indoor, outdoor, landscape, urban, etc.)
3. Time context if apparent (day/night, season, era)
4. Composition and framing
5. Colors and lighting
6. Any activities or actions
7. Mood or emotional tone

Capture what someone would search for to find this image.`
};

type PromptType = keyof typeof PROMPT_TEMPLATES;

export class ImageIndexer {
  private host: string;
  private model: string;
  private timeout: number;
  private available: boolean | null = null;

  constructor(config: VisionModelConfig = {}) {
    this.host = config.host || process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.model = config.model || process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision:11b';
    this.timeout = config.timeout || 60000; // 60 seconds default for vision models
  }

  /**
   * Check if the vision model is available
   */
  async checkAvailability(): Promise<boolean> {
    if (this.available !== null) return this.available;

    try {
      const response = await fetch(`${this.host}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.available = false;
        return false;
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      const models = data.models || [];
      
      // Check if the vision model is available (match by name prefix)
      this.available = models.some(m => 
        m.name === this.model || 
        m.name.startsWith(this.model.split(':')[0])
      );
      
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  /**
   * Get the vision model name
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Extract metadata from an image file
   */
  async extractMetadata(imagePath: string): Promise<ImageMetadata> {
    const stats = fs.statSync(imagePath);
    const sizeBytes = stats.size;
    
    const ext = path.extname(imagePath).toLowerCase().replace('.', '');
    const format = this.normalizeFormat(ext);

    // Read image header to get dimensions
    const dimensions = await this.getImageDimensions(imagePath);

    return {
      width: dimensions.width,
      height: dimensions.height,
      format,
      sizeBytes,
    };
  }

  /**
   * Get image dimensions by reading file headers
   */
  private async getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
    const buffer = fs.readFileSync(imagePath);
    
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    
    // JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      return this.getJpegDimensions(buffer);
    }
    
    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return { width, height };
    }
    
    // WebP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      // WebP dimensions are in the VP8/VP8L chunk
      const webpDimensions = this.getWebPDimensions(buffer);
      if (webpDimensions) return webpDimensions;
    }
    
    // Fallback: return 0x0 if we can't determine dimensions
    return { width: 0, height: 0 };
  }

  /**
   * Parse JPEG dimensions from buffer
   */
  private getJpegDimensions(buffer: Buffer): { width: number; height: number } {
    let offset = 2;
    
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }
      
      const marker = buffer[offset + 1];
      
      // SOF0, SOF1, SOF2 markers contain dimensions
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }
      
      // Skip to next marker
      const length = buffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
    
    return { width: 0, height: 0 };
  }

  /**
   * Parse WebP dimensions from buffer
   */
  private getWebPDimensions(buffer: Buffer): { width: number; height: number } | null {
    // Check for VP8 chunk
    if (buffer.length > 28 && 
        buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
      // VP8 bitstream
      const width = (buffer.readUInt16LE(26) & 0x3FFF);
      const height = (buffer.readUInt16LE(28) & 0x3FFF);
      return { width, height };
    }
    
    // Check for VP8L chunk (lossless)
    if (buffer.length > 22 &&
        buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4C) {
      // VP8L bitstream - dimensions are encoded differently
      const bits = buffer.readUInt32LE(21);
      const width = (bits & 0x3FFF) + 1;
      const height = ((bits >> 14) & 0x3FFF) + 1;
      return { width, height };
    }
    
    return null;
  }

  /**
   * Normalize image format string
   */
  private normalizeFormat(ext: string): string {
    const formatMap: Record<string, string> = {
      'jpg': 'jpeg',
      'jpeg': 'jpeg',
      'png': 'png',
      'gif': 'gif',
      'webp': 'webp',
    };
    return formatMap[ext] || ext;
  }

  /**
   * Detect image type based on path/filename hints
   */
  private detectPromptType(imagePath: string): PromptType {
    const lowerPath = imagePath.toLowerCase();
    
    // Check for screenshots
    if (lowerPath.includes('screenshot') || 
        lowerPath.includes('capture') ||
        lowerPath.includes('screen') ||
        lowerPath.includes('desktop')) {
      return 'screenshot';
    }
    
    // Check for documents
    if (lowerPath.includes('document') ||
        lowerPath.includes('doc') ||
        lowerPath.includes('scan') ||
        lowerPath.includes('receipt') ||
        lowerPath.includes('invoice') ||
        lowerPath.match(/\/receipts?\//i) ||
        lowerPath.match(/\/invoices?\//i) ||
        lowerPath.match(/\/documents?\//i)) {
      return 'document';
    }
    
    // Check for photos
    if (lowerPath.includes('photo') ||
        lowerPath.includes('img_') ||
        lowerPath.includes('dsc') ||
        lowerPath.includes('camera') ||
        lowerPath.match(/\/photos?\//i) ||
        lowerPath.match(/\/pictures?\//i) ||
        lowerPath.match(/\/images?\//i)) {
      return 'photo';
    }
    
    return 'general';
  }

  /**
   * Generate description for an image using Ollama vision model
   */
  async generateDescription(imagePath: string, promptType?: PromptType): Promise<string> {
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    
    const ext = path.extname(imagePath).toLowerCase().replace('.', '');
    const mimeType = this.getMimeType(ext);
    
    const detectedType = promptType || this.detectPromptType(imagePath);
    const prompt = PROMPT_TEMPLATES[detectedType];

    const response = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{
          role: 'user',
          content: prompt,
          images: [base64Image],
        }],
        stream: false,
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision model request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as { 
      message?: { content?: string };
      error?: string;
    };

    if (data.error) {
      throw new Error(`Vision model error: ${data.error}`);
    }

    return data.message?.content?.trim() || '';
  }

  /**
   * Get MIME type for image format
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
    };
    return mimeTypes[ext] || 'image/jpeg';
  }

  /**
   * Index a single image file
   */
  async indexImage(imagePath: string): Promise<ImageDescription> {
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    // Extract metadata
    const metadata = await this.extractMetadata(imagePath);

    // Generate description using vision model
    const description = await this.generateDescription(imagePath);

    return {
      description,
      metadata,
      imagePath,
    };
  }

  /**
   * Index multiple image files
   */
  async indexImages(imagePaths: string[], onProgress?: (current: number, total: number, path: string) => void): Promise<ImageDescription[]> {
    const results: ImageDescription[] = [];
    const total = imagePaths.length;

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      
      if (onProgress) {
        onProgress(i + 1, total, imagePath);
      }

      try {
        const result = await this.indexImage(imagePath);
        results.push(result);
      } catch (error) {
        console.warn(`Failed to index image ${imagePath}: ${error}`);
      }
    }

    return results;
  }
}

/**
 * Check if a file is a supported image type
 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  return ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
}

/**
 * Get all image files in a directory (non-recursive by default)
 */
export async function findImageFiles(directory: string, recursive: boolean = false): Promise<string[]> {
  const images: string[] = [];
  
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    
    if (entry.isDirectory() && recursive) {
      const subImages = await findImageFiles(fullPath, recursive);
      images.push(...subImages);
    } else if (entry.isFile() && isImageFile(fullPath)) {
      images.push(fullPath);
    }
  }
  
  return images;
}