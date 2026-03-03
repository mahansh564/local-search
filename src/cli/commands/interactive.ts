#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { RAGPipeline } from "../../search/pipeline.js";
import { OllamaClient } from "../../llm/ollama.js";
import { buildMessages, type DocumentContext } from "../../llm/prompts.js";
import path from "path";
import os from "os";

const theme = {
  white: "#fcfcfc",
  bubblegumPink: "#f7567c",
  cornsilk: "#fffae3",
  pearlAqua: "#99e1d9",
  taupeGrey: "#5d576b",
  bgDark: "#1a1a2e",
  border: "#2a2a4a",
};

const ESC = {
  clear: "\x1b[2J\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
};

function hexToAnsi(hex: string, isBg = false): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return isBg ? `\x1b[48;2;${r};${g};${b}m` : `\x1b[38;2;${r};${g};${b}m`;
}

function c(text: string, hex: string, isBg = false): string {
  return hexToAnsi(hex, isBg) + text + "\x1b[0m";
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function padVisible(text: string, width: number): string {
  const len = visibleLength(text);
  if (len >= width) return text;
  return text + " ".repeat(width - len);
}

function padCentered(text: string, width: number): string {
  const len = visibleLength(text);
  if (len >= width) return text.slice(0, width);
  const left = Math.floor((width - len) / 2);
  return " ".repeat(left) + text + " ".repeat(width - len - left);
}

function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return text.slice(0, max - 3) + "...";
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [""];
  const lines: string[] = [];
  const paragraphs = text.split("\n");
  for (const p of paragraphs) {
    const words = p.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > width) {
        if (line) lines.push(line);
        line = word.length > width ? word.slice(0, width) : word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function sliceForInput(value: string, cursor: number, max: number): { text: string; cursorOffset: number } {
  if (max <= 0) return { text: "", cursorOffset: 0 };
  if (value.length <= max) return { text: value, cursorOffset: cursor };
  let start = cursor - max + 1;
  if (start < 0) start = 0;
  let end = start + max;
  if (end > value.length) {
    end = value.length;
    start = Math.max(0, end - max);
  }
  return { text: value.slice(start, end), cursorOffset: cursor - start };
}

function renderWordmarkLines(width: number, variant: "hero" | "compact"): string[] {
  if (variant === "compact") {
    const left = "local";
    const right = "search";
    const mark = c(left, theme.taupeGrey) + " " + c(right, theme.cornsilk);
    return [padCentered(mark, width)];
  }

  const localLines = [
    "██╗      ██████╗  ██████╗  █████╗ ██╗     ",
    "██║     ██╔═══██╗██╔════╝ ██╔══██╗██║     ",
    "██║     ██║   ██║██║     ███████║██║      ",
    "██║     ██║   ██║██║     ██╔══██║██║      ",
    "███████╗╚██████╔╝╚██████╔╝██║  ██║███████╗",
    "╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝",
  ];

  const searchLines = [
    "███████╗███████╗ █████╗ ██████╗  ██████╗██╗  ██╗",
    "██╔════╝██╔════╝██╔══██╗██╔══██╗██╔════╝██║  ██║",
    "███████╗█████╗  ███████║██████╔╝██║     ███████║",
    "╚════██║██╔══╝  ██╔══██║██╔══██╗██║     ██╔══██║",
    "███████║███████╗██║  ██║██║  ██║╚██████╗██║  ██║",
    "╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝",
  ];

  const lines: string[] = [];
  localLines.forEach((line, i) => {
    const color = i === 0 || i === localLines.length - 1 ? theme.bubblegumPink : theme.taupeGrey;
    lines.push(c(padCentered(line, width), color));
  });
  lines.push(" ".repeat(width));
  searchLines.forEach((line, i) => {
    const color = i === 0 || i === searchLines.length - 1 ? theme.pearlAqua : theme.cornsilk;
    lines.push(c(padCentered(line, width), color));
  });

  return lines;
}

function extractTextContent(rawContent: string): string {
  try {
    const parsed = JSON.parse(rawContent);
    if (parsed.content && Array.isArray(parsed.content)) {
      return parsed.content
        .map((block: any) => block.text || "")
        .join("\n")
        .trim();
    }
    if (typeof parsed === "string") {
      return parsed;
    }
    return rawContent;
  } catch {
    return rawContent;
  }
}

interface ConversationEntry {
  query: string;
  answer: string;
  sources: DocumentContext[];
  error?: string;
}

interface RenderOutput {
  screen: string;
  cursorRow: number;
  cursorCol: number;
}

export async function interactiveCommand() {
  const dbPath = path.join(os.homedir(), ".search-cli", "index.sqlite");

  const fs = await import("fs");
  if (!fs.existsSync(dbPath)) {
    console.log("Database not initialized. Run 'search-cli init' first.");
    process.exit(1);
  }

  const db = new Database(dbPath);
  const pipeline = new RAGPipeline(db, {
    enableReranking: true,
    enableMMR: false,
    mmrLambda: 0.5,
    enableQueryExpansion: false,
  });

  await pipeline.initialize();

  const state = {
    mode: "stage1" as "stage1" | "stage2",
    input: "",
    cursor: 0,
    status: "",
    isBusy: false,
    conversation: [] as ConversationEntry[],
    currentSources: [] as DocumentContext[],
  };

  const modelName = process.env.OLLAMA_MODEL || "llama3.1";

  const w = () => process.stdout.columns || 80;
  const h = () => process.stdout.rows || 24;

  const renderStage1 = (): RenderOutput => {
    const width = w();
    const height = h();
    const lines: string[] = [];

    const wordmarkLines = renderWordmarkLines(width, "hero");
    const reserved = wordmarkLines.length + 6;
    const topPad = Math.max(1, Math.floor((height - reserved) / 3));
    for (let i = 0; i < topPad; i++) lines.push(" ".repeat(width));

    lines.push(...wordmarkLines);
    lines.push(" ".repeat(width));

    const boxWidth = Math.min(80, Math.max(40, width - 10));
    const leftPad = Math.floor((width - boxWidth) / 2);

    const topBorder = "┌" + "─".repeat(boxWidth - 2) + "┐";
    const bottomBorder = "└" + "─".repeat(boxWidth - 2) + "┘";

    const inputMax = boxWidth - 4;
    const slice = sliceForInput(state.input, state.cursor, inputMax);
    const placeholder = "Ask anything... \"What do my notes say about this week's TODO list?\"";
    const display = state.input.length > 0 ? slice.text : placeholder;
    const displayText = truncate(display, inputMax);
    const displayColor = state.input.length > 0 ? theme.cornsilk : theme.taupeGrey;

    const inputLine =
      " ".repeat(leftPad) +
      c("│ ", theme.pearlAqua) +
      c(displayText.padEnd(inputMax), displayColor) +
      c(" │", theme.pearlAqua);

    lines.push(" ".repeat(leftPad) + c(topBorder, theme.pearlAqua));
    const inputRow = lines.length + 1;
    lines.push(inputLine);
    lines.push(" ".repeat(leftPad) + c(bottomBorder, theme.pearlAqua));

    const meta = `Ollama ${modelName}  •  Local Search  •  tab agents  ctrl+p commands`;
    lines.push(" ".repeat(leftPad) + c(truncate(meta, boxWidth), theme.taupeGrey));

    while (lines.length < height) lines.push(" ".repeat(width));

    const cursorRow = inputRow;
    const cursorCol = leftPad + 3 + slice.cursorOffset;

    return { screen: lines.join("\n"), cursorRow, cursorCol };
  };

  const renderConversation = (width: number, height: number): string[] => {
    const lines: string[] = [];

    for (const entry of state.conversation) {
      const qPrefix = c("You", theme.bubblegumPink) + ": ";
      const qAvail = Math.max(10, width - visibleLength(qPrefix));
      const qLines = wrapText(entry.query, qAvail);
      const aText = entry.error ? entry.error : entry.answer;
      const aPrefix = c("Answer", theme.pearlAqua) + ": ";
      const aAvail = Math.max(10, width - visibleLength(aPrefix));
      const aLines = wrapText(aText, aAvail);

      qLines.forEach((line, idx) => {
        const prefix = idx === 0 ? qPrefix : " ".repeat(visibleLength(qPrefix));
        lines.push(prefix + c(line, theme.white));
      });

      aLines.forEach((line, idx) => {
        const prefix = idx === 0 ? aPrefix : " ".repeat(visibleLength(aPrefix));
        lines.push(prefix + c(line, theme.cornsilk));
      });

      lines.push("");
    }

    if (lines.length > height) {
      return lines.slice(lines.length - height);
    }

    while (lines.length < height) lines.push("");
    return lines;
  };

  const renderSources = (width: number, height: number): string[] => {
    const lines: string[] = [];
    const docs = state.currentSources;
    for (const doc of docs) {
      const title = doc.title || doc.path.split("/").pop() || "Unknown";
      lines.push(c(truncate(title, width), theme.cornsilk));
      lines.push(c(truncate(doc.path, width), theme.taupeGrey));
      lines.push("");
    }
    if (lines.length > height) {
      return lines.slice(0, height);
    }
    while (lines.length < height) lines.push("");
    return lines;
  };

  const renderStage2 = (): RenderOutput => {
    const width = w();
    const height = h();
    const lines: string[] = [];

    lines.push(...renderWordmarkLines(width, "compact"));
    lines.push(c("─".repeat(width), theme.border));

    const rightWidth = Math.max(26, Math.floor(width * 0.28));
    const leftWidth = width - rightWidth - 3;

    lines.push(
      c("│", theme.border) +
        padVisible("".padEnd(leftWidth), leftWidth) +
        c("│", theme.border) +
        padVisible(c(truncate("Sources", rightWidth), theme.bubblegumPink), rightWidth) +
        c("│", theme.border)
    );

    const statusLines = state.status ? 1 : 0;
    const footerLines = 4;
    const available = height - lines.length - statusLines - footerLines;

    const convoLines = renderConversation(leftWidth, Math.max(1, available));
    const sourceLines = renderSources(rightWidth, Math.max(1, available));

    for (let i = 0; i < available; i++) {
      const left = convoLines[i] || "";
      const right = sourceLines[i] || "";
      lines.push(
        c("│", theme.border) +
          padVisible(left, leftWidth) +
          c("│", theme.border) +
          padVisible(right, rightWidth) +
          c("│", theme.border)
      );
    }

    if (state.status) {
      const status = c(truncate(state.status, width), theme.pearlAqua);
      lines.push(status.padEnd(width));
    }

    const inputWidth = width - 4;
    const slice = sliceForInput(state.input, state.cursor, inputWidth - 2);
    const placeholder = "Ask anything...";
    const display = state.input.length > 0 ? slice.text : placeholder;
    const displayText = truncate(display, inputWidth - 2);
    const displayColor = state.input.length > 0 ? theme.cornsilk : theme.taupeGrey;

    lines.push(c("┌" + "─".repeat(width - 2) + "┐", theme.pearlAqua));
    const inputRow = lines.length + 1;
    lines.push(c("│ ", theme.pearlAqua) + c(displayText.padEnd(inputWidth - 2), displayColor) + c(" │", theme.pearlAqua));
    lines.push(c("└" + "─".repeat(width - 2) + "┘", theme.pearlAqua));

    const hint = c("tab agents  ctrl+p commands", theme.taupeGrey);
    lines.push(hint.padStart(width));

    while (lines.length < height) lines.push(" ".repeat(width));

    const cursorRow = inputRow;
    const cursorCol = 3 + slice.cursorOffset;

    return { screen: lines.join("\n"), cursorRow, cursorCol };
  };

  const render = () => {
    const output = state.mode === "stage1" ? renderStage1() : renderStage2();
    process.stdout.write(ESC.hideCursor);
    process.stdout.write(ESC.clear);
    process.stdout.write(output.screen);
    process.stdout.write(`\x1b[${output.cursorRow};${output.cursorCol}H`);
    process.stdout.write(ESC.showCursor);
  };

  const submit = async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || state.isBusy) return;

    state.input = "";
    state.cursor = 0;

    if (state.mode === "stage1") state.mode = "stage2";

    const entry: ConversationEntry = {
      query: trimmed,
      answer: "",
      sources: [],
    };
    state.conversation.push(entry);

    state.isBusy = true;
    state.status = "Searching...";
    render();

    try {
      const results = await pipeline.search(trimmed, {
        limit: 5,
        enableMMR: false,
        enableQueryExpansion: false,
        includeFullDocument: true,
      });

      if (results.length === 0) {
        entry.answer = "No documents found. Please index documents first.";
        state.currentSources = [];
        state.status = "";
        state.isBusy = false;
        render();
        return;
      }

      const documents: DocumentContext[] = results.map((r: any) => ({
        title: r.title || r.path.split("/").pop() || "Unknown",
        path: r.path,
        content: extractTextContent(r.fullContent || r.content || ""),
      }));

      entry.sources = documents;
      state.currentSources = documents;

      const ollama = new OllamaClient({});
      const isConnected = await ollama.checkConnection();
      if (!isConnected) {
        entry.error = 'Cannot connect to Ollama. Is it running? (ollama serve)';
        state.status = "";
        state.isBusy = false;
        render();
        return;
      }

      state.status = "Generating...";
      render();

      const messages = buildMessages(documents, trimmed);

      for await (const chunk of ollama.streamChat(messages)) {
        entry.answer += chunk;
        render();
      }

      state.status = "";
      state.isBusy = false;
      render();
    } catch (error: any) {
      entry.error = `Error: ${error?.message || error}`;
      state.status = "";
      state.isBusy = false;
      render();
    }
  };

  const cleanup = () => {
    process.stdout.write(ESC.showCursor);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  };

  const onKey = (data: Buffer) => {
    const str = data.toString("utf8");

    if (str === "\x03") {
      cleanup();
      process.exit(0);
    }

    if (state.isBusy) return;

    if (str === "\r" || str === "\n") {
      void submit(state.input);
      return;
    }

    if (str === "\x7f") {
      if (state.cursor > 0) {
        state.input = state.input.slice(0, state.cursor - 1) + state.input.slice(state.cursor);
        state.cursor -= 1;
        render();
      }
      return;
    }

    if (str === "\x15") {
      state.input = "";
      state.cursor = 0;
      render();
      return;
    }

    if (str === "\x1b[D") {
      if (state.cursor > 0) state.cursor -= 1;
      render();
      return;
    }

    if (str === "\x1b[C") {
      if (state.cursor < state.input.length) state.cursor += 1;
      render();
      return;
    }

    if (str === "\x1b[H" || str === "\x1bOH") {
      state.cursor = 0;
      render();
      return;
    }

    if (str === "\x1b[F" || str === "\x1bOF") {
      state.cursor = state.input.length;
      render();
      return;
    }

    if (str.startsWith("\x1b")) return;

    for (const ch of str) {
      if (ch >= " " && ch !== "\x7f") {
        state.input = state.input.slice(0, state.cursor) + ch + state.input.slice(state.cursor);
        state.cursor += 1;
      }
    }
    render();
  };

  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  process.stdout.on("resize", () => {
    render();
  });

  process.stdin.on("data", onKey);

  render();
}
