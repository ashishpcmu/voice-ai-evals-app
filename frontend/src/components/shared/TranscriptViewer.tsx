import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, BookOpen, User, Bot, Clock, CheckCircle, XCircle } from 'lucide-react';
import type { TranscriptTurn, ToolCall, KBCall } from '../../types';

interface TranscriptViewerProps {
  turns: TranscriptTurn[];
  toolCalls: ToolCall[];
  kbCalls: KBCall[];
  onTurnClick?: (turnId: string) => void;
  highlightedTurnId?: string;
}

function formatTime(ms: number, wallClock: boolean): string {
  if (wallClock) {
    const totalMs = ms;
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const msRem = totalMs % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msRem).padStart(3, '0')}`;
  }
  return `T+${(ms / 1000).toFixed(1)}s`;
}

function ToolCallRow({ turn, toolCall }: { turn: TranscriptTurn; toolCall: ToolCall; wallClock: boolean; showWallClock: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-l-4 border-accent-teal bg-gray-50 rounded-r-lg mx-2 my-1">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench size={14} className="text-accent-teal flex-shrink-0" />
        <span className="text-xs font-semibold text-gray-700">TOOL CALL</span>
        <span className="text-xs font-mono text-dark-text font-bold">— {toolCall.tool_name}</span>
        <div className="ml-auto flex items-center gap-2">
          {toolCall.latency_ms && (
            <span className="text-xs text-gray-text">{toolCall.latency_ms}ms</span>
          )}
          {toolCall.status === 'success' ? (
            <CheckCircle size={12} className="text-success-green" />
          ) : (
            <XCircle size={12} className="text-error-red" />
          )}
          {expanded ? <ChevronDown size={12} className="text-gray-text" /> : <ChevronRight size={12} className="text-gray-text" />}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {toolCall.input_args && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Input</div>
              <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto text-gray-700 font-mono">
                {JSON.stringify(toolCall.input_args, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.response && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Output</div>
              <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto text-gray-700 font-mono">
                {JSON.stringify(toolCall.response, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KBCallRow({ kbCall }: { kbCall: KBCall }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());

  const toggleChunk = (i: number) => {
    setExpandedChunks(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const scoreColor = (score: number) => {
    if (score >= 0.8) return 'text-success-green';
    if (score >= 0.6) return 'text-warning-amber';
    return 'text-error-red';
  };

  return (
    <div className="border-l-4 border-primary-blue bg-blue-50 rounded-r-lg mx-2 my-1">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-100 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <BookOpen size={14} className="text-primary-blue flex-shrink-0" />
        <span className="text-xs font-semibold text-blue-700">KB LOOKUP</span>
        <span className="text-xs font-mono text-dark-text font-bold">— {kbCall.kb_source || 'knowledge_base'}</span>
        <div className="ml-auto flex items-center gap-2">
          {kbCall.latency_ms && (
            <span className="text-xs text-gray-text">{kbCall.latency_ms}ms</span>
          )}
          <span className="text-xs text-blue-600">{kbCall.chunks?.length || 0} chunks</span>
          {expanded ? <ChevronDown size={12} className="text-gray-text" /> : <ChevronRight size={12} className="text-gray-text" />}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div className="text-xs text-gray-600"><span className="font-semibold">Query:</span> {kbCall.query}</div>
          {kbCall.chunks?.map((chunk, i) => (
            <div key={i} className="bg-white border border-blue-200 rounded overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 transition-colors text-left"
                onClick={() => toggleChunk(i)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-500">{i + 1}.</span>
                  <span className="text-xs font-medium text-dark-text truncate">{chunk.title}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs font-semibold ${scoreColor(chunk.score)}`}>
                    {chunk.score.toFixed(2)}
                  </span>
                  {expandedChunks.has(i) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </div>
              </button>
              {expandedChunks.has(i) && (
                <div className="px-3 pb-2">
                  <p className="text-xs text-gray-600 leading-relaxed">{chunk.snippet}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TranscriptViewer({
  turns,
  toolCalls,
  kbCalls,
  onTurnClick,
  highlightedTurnId,
}: TranscriptViewerProps) {
  const [wallClock, setWallClock] = useState(false);

  // Build a map of tool/kb calls by turn_id
  const toolCallsByTurnId = new Map<string, ToolCall>();
  for (const tc of toolCalls) {
    toolCallsByTurnId.set(tc.turn_id, tc);
  }
  const kbCallsByTurnId = new Map<string, KBCall>();
  for (const kb of kbCalls) {
    kbCallsByTurnId.set(kb.turn_id, kb);
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-dark-text">Transcript</span>
          <span className="text-xs text-gray-text">{turns.filter(t => t.role !== 'tool' && t.role !== 'kb').length} turns</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWallClock(!wallClock)}
            className="flex items-center gap-1.5 text-xs text-gray-text hover:text-dark-text transition-colors"
          >
            <Clock size={12} />
            {wallClock ? 'Wall Clock' : 'Relative Time'}
          </button>
        </div>
      </div>

      {/* Turns */}
      <div className="divide-y divide-gray-50">
        {turns.map(turn => {
          const toolCall = toolCallsByTurnId.get(turn.id);
          const kbCall = kbCallsByTurnId.get(turn.id);

          if (turn.role === 'tool' && toolCall) {
            return (
              <div key={turn.id} className="py-1">
                <div className="px-4 text-xs text-gray-400 mb-0.5">
                  {turn.timestamp_ms !== undefined ? formatTime(turn.timestamp_ms, wallClock) : ''}
                </div>
                <ToolCallRow turn={turn} toolCall={toolCall} wallClock={wallClock} showWallClock={wallClock} />
              </div>
            );
          }

          if (turn.role === 'kb' && kbCall) {
            return (
              <div key={turn.id} className="py-1">
                <div className="px-4 text-xs text-gray-400 mb-0.5">
                  {turn.timestamp_ms !== undefined ? formatTime(turn.timestamp_ms, wallClock) : ''}
                </div>
                <KBCallRow kbCall={kbCall} />
              </div>
            );
          }

          const isUser = turn.role === 'user';
          const isHighlighted = highlightedTurnId === turn.id;

          return (
            <div
              key={turn.id}
              className={`px-4 py-3 flex gap-3 transition-colors ${isHighlighted ? 'bg-yellow-50 border-l-4 border-yellow-400' : 'hover:bg-gray-50'} ${onTurnClick ? 'cursor-pointer' : ''}`}
              onClick={() => onTurnClick?.(turn.id)}
            >
              {/* Avatar */}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isUser ? 'bg-gray-200' : 'bg-primary-blue'}`}>
                {isUser
                  ? <User size={12} className="text-gray-600" />
                  : <Bot size={12} className="text-white" />
                }
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold ${isUser ? 'text-gray-600' : 'text-primary-blue'}`}>
                    {isUser ? 'Customer' : 'Agent'}
                  </span>
                  {turn.timestamp_ms !== undefined && (
                    <span className="text-xs text-gray-400">
                      {formatTime(turn.timestamp_ms, wallClock)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-dark-text leading-relaxed">{turn.content}</p>
              </div>
            </div>
          );
        })}
      </div>

      {turns.length === 0 && (
        <div className="flex items-center justify-center py-12 text-gray-text text-sm">
          No transcript turns available
        </div>
      )}
    </div>
  );
}
