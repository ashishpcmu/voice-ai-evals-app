import { v4 as uuidv4 } from 'uuid';

export interface ParsedTurn {
  id: string;
  role: 'user' | 'agent' | 'tool' | 'kb';
  content: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface ParseResult {
  turns: ParsedTurn[];
  raw_text: string;
  turn_count: number;
  has_tool_calls: boolean;
  has_kb_calls: boolean;
}

export function parseTranscriptText(text: string): ParseResult {
  const lines = text.split('\n');
  const turns: ParsedTurn[] = [];
  let currentTurn: Partial<ParsedTurn> | null = null;
  let currentContent: string[] = [];

  const timestampRegex = /^\[(\d{2}:\d{2}:\d{2}|\T\+[\d.]+s)\]/;
  const agentRegex = /^(Agent:|BOT:|Assistant:)\s*/i;
  const userRegex = /^(Customer:|User:|Human:)\s*/i;
  const toolRegex = /^(TOOL CALL:|TOOL:|#TOOL\])\s*/i;
  const kbRegex = /^(KB LOOKUP:|KB:|#KB\])\s*/i;

  function flushCurrentTurn() {
    if (currentTurn && currentContent.length > 0) {
      turns.push({
        id: uuidv4(),
        role: currentTurn.role || 'agent',
        content: currentContent.join('\n').trim(),
        timestamp: currentTurn.timestamp,
        metadata: currentTurn.metadata || {}
      });
    }
    currentTurn = null;
    currentContent = [];
  }

  for (const line of lines) {
    if (!line.trim()) continue;

    // Check for timestamp
    const timestampMatch = line.match(timestampRegex);
    const lineWithoutTimestamp = timestampMatch ? line.replace(timestampRegex, '').trim() : line;
    const timestamp = timestampMatch ? timestampMatch[1] : undefined;

    // Determine role
    if (agentRegex.test(lineWithoutTimestamp)) {
      flushCurrentTurn();
      currentTurn = { role: 'agent', timestamp };
      currentContent = [lineWithoutTimestamp.replace(agentRegex, '').trim()];
    } else if (userRegex.test(lineWithoutTimestamp)) {
      flushCurrentTurn();
      currentTurn = { role: 'user', timestamp };
      currentContent = [lineWithoutTimestamp.replace(userRegex, '').trim()];
    } else if (toolRegex.test(lineWithoutTimestamp)) {
      flushCurrentTurn();
      const toolName = lineWithoutTimestamp.replace(toolRegex, '').split(/[({]/)[0].trim();
      currentTurn = { role: 'tool', timestamp, metadata: { tool_name: toolName } };
      currentContent = [lineWithoutTimestamp];
    } else if (kbRegex.test(lineWithoutTimestamp)) {
      flushCurrentTurn();
      const kbSource = lineWithoutTimestamp.replace(kbRegex, '').trim();
      currentTurn = { role: 'kb', timestamp, metadata: { kb_source: kbSource } };
      currentContent = [lineWithoutTimestamp];
    } else if (currentTurn) {
      // Continue current turn
      currentContent.push(line.trim());
    } else if (line.trim()) {
      // Unclassified line — treat as agent by default
      flushCurrentTurn();
      currentTurn = { role: 'agent', timestamp };
      currentContent = [line.trim()];
    }
  }

  flushCurrentTurn();

  const hasToolCalls = turns.some(t => t.role === 'tool');
  const hasKBCalls = turns.some(t => t.role === 'kb');

  return {
    turns,
    raw_text: text,
    turn_count: turns.length,
    has_tool_calls: hasToolCalls,
    has_kb_calls: hasKBCalls
  };
}

export async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text;
  } catch {
    throw new Error('Failed to parse PDF file');
  }
}

export async function parseDOCX(buffer: Buffer): Promise<string> {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch {
    throw new Error('Failed to parse DOCX file');
  }
}
