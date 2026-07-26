import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDevkit } from '@/hooks/useDevkit';
import { EMITTABLE_EVENTS, type BridgeLogEntry } from '@/lib/devkit';
import { analyzeLogs, reportToMarkdown } from '@/lib/analyzer';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Layers,
  List,
  Pause,
  Play,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

const EVENT_COLORS: Record<string, string> = {
  web_app_ready: '#22c55e',
  web_app_close: '#ef4444',
  web_app_expand: '#3b82f6',
  web_app_setup_main_button: '#8b5cf6',
  web_app_data_send: '#f59e0b',
  theme_changed: '#06b6d4',
  viewport_changed: '#a855f7',
  main_button_pressed: '#ec4899',
  back_button_pressed: '#f97316',
  popup_closed: '#84cc16',
};

function formatTimestamp(ts: number) {
  const d = new Date(ts);
  return `${d.toLocaleTimeString('en-GB')}.${String(ts % 1000).padStart(3, '0')}`;
}

function Payload({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => JSON.stringify(data, null, 2) ?? 'undefined', [data]);
  const oneLine = useMemo(() => JSON.stringify(data) ?? 'undefined', [data]);
  if (oneLine === '{}' || oneLine === '""' || oneLine === 'null') return null;
  return (
    <button
      onClick={() => setOpen((o) => !o)}
      className="mt-0.5 block w-full rounded bg-zinc-900/80 px-1.5 py-1 text-left font-mono text-[10px] leading-snug text-zinc-400 hover:bg-zinc-900"
      title={open ? 'Collapse' : 'Expand'}
    >
      {open ? (
        <pre className="whitespace-pre-wrap break-all">{text}</pre>
      ) : (
        <span className="block truncate">{oneLine}</span>
      )}
    </button>
  );
}

function EventRow({ entry }: { entry: BridgeLogEntry }) {
  const color = EVENT_COLORS[entry.eventType] || '#71717a';
  return (
    <div className="rounded border border-zinc-800/70 bg-zinc-900/40 px-1.5 py-1 hover:border-zinc-700/80 transition-colors">
      <div className="flex items-center gap-1.5">
        {entry.dir === 'out' ? (
          <ArrowUpFromLine className="h-3 w-3 text-emerald-500 shrink-0" />
        ) : (
          <ArrowDownToLine className="h-3 w-3 text-sky-400 shrink-0" />
        )}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <Badge
            variant="outline"
            className="font-mono text-[9px] truncate border-zinc-700 bg-zinc-900/60 text-zinc-300"
          >
            {entry.eventType}
          </Badge>
          <span className="font-mono text-[9px] text-zinc-600 shrink-0 ml-auto">
            {formatTimestamp(entry.ts)}
          </span>
        </div>
      </div>
      <Payload data={entry.data} />
    </div>
  );
}

export function EventInspector() {
  const {
    logs,
    paused,
    setPaused,
    filter,
    setFilter,
    autoscroll,
    setAutoscroll,
    clearLogs,
    emitEvent,
    config,
    appUrl,
  } = useDevkit();

  const [emitName, setEmitName] = useState(EMITTABLE_EVENTS[0].name);
  const [emitPayload, setEmitPayload] = useState(EMITTABLE_EVENTS[0].payload);
  const [emitError, setEmitError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('grouped');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [aiCopied, setAiCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return logs;
    return logs.filter(
      (l) =>
        l.eventType.toLowerCase().includes(f) ||
        JSON.stringify(l.data)?.toLowerCase().includes(f),
    );
  }, [logs, filter]);

  /** Group logs by eventType */
  const groups = useMemo(() => {
    if (viewMode !== 'grouped') return null;
    const map = new Map<string, BridgeLogEntry[]>();
    // preserve chronological order of groups (first occurrence)
    const order: string[] = [];
    for (const entry of visible) {
      if (!map.has(entry.eventType)) {
        map.set(entry.eventType, []);
        order.push(entry.eventType);
      }
      map.get(entry.eventType)!.push(entry);
    }
    return order.map((name) => ({ name, entries: map.get(name)! }));
  }, [visible, viewMode]);

  useEffect(() => {
    if (autoscroll) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [visible.length, autoscroll]);

  function sendEmit() {
    let data: unknown = {};
    try {
      data = emitPayload.trim() ? JSON.parse(emitPayload) : {};
    } catch (e) {
      setEmitError((e as Error).message);
      return;
    }
    setEmitError(null);
    emitEvent(emitName, data);
  }

  function toggleGroup(name: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function exportLogs() {
    const text = visible.map((l) =>
      `[${formatTimestamp(l.ts)}] ${l.dir === 'out' ? 'OUT' : 'IN '} ${l.eventType} ${JSON.stringify(l.data)}`
    ).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tma-devkit-events-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAiReport() {
    const scenario = `${config.platform} ${config.colorScheme} · ${config.user.is_premium ? 'Premium' : 'Free'} User`;
    const report = analyzeLogs(logs, appUrl ?? config.url, scenario);
    const md = reportToMarkdown(report);
    navigator.clipboard?.writeText(md).then(() => {
      setAiCopied(true);
      setTimeout(() => setAiCopied(false), 1500);
    }).catch(() => {
      // clipboard API failed — fallback: select all text in a hidden textarea
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setAiCopied(true);
      setTimeout(() => setAiCopied(false), 1500);
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* header + controls */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-zinc-800 px-2">
        <span className="text-[11px] font-semibold text-zinc-300">Bridge events</span>
        <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-500">
          {visible.length}
        </Badge>
        <div className="ml-auto flex items-center gap-0.5">
          {/* View toggle */}
          <div className="flex rounded border border-zinc-700 mr-1">
            <button
              onClick={() => setViewMode('flat')}
              className={`px-1 py-0.5 rounded-l ${viewMode === 'flat' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="Flat list"
            >
              <List className="h-3 w-3" />
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`px-1 py-0.5 rounded-r ${viewMode === 'grouped' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="Grouped by type"
            >
              <Layers className="h-3 w-3" />
            </button>
          </div>
          <button
            onClick={() => setPaused(!paused)}
            title={paused ? 'Resume capture' : 'Pause capture'}
            className={`rounded p-1 hover:bg-zinc-800 ${paused ? 'text-amber-400' : 'text-zinc-500'}`}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => setAutoscroll(!autoscroll)}
            title="Toggle autoscroll"
            className={`rounded p-1 hover:bg-zinc-800 ${autoscroll ? 'text-sky-400' : 'text-zinc-600'}`}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={exportLogs}
            title="Export logs"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={exportAiReport}
            title={aiCopied ? 'Copied!' : 'Export AI Report — copy Markdown to clipboard'}
            className={`rounded p-1 transition-colors ${
              aiCopied ? 'text-emerald-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-purple-400'
            }`}
          >
            {aiCopied ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={clearLogs}
            title="Clear log"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* filter */}
      <div className="shrink-0 border-b border-zinc-800 p-2">
        <div className="relative">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter by eventType or payload…"
            className="h-7 pr-7 border-zinc-800 bg-zinc-900 text-[11px] text-zinc-300"
            spellCheck={false}
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* log */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {visible.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-8 text-center">
              <Ban className="h-4 w-4 text-zinc-700" />
              <p className="text-[11px] text-zinc-600">
                No bridge events yet.
                <br />
                Interact with the mini app — every web_app_* call appears here.
              </p>
            </div>
          )}

          {viewMode === 'grouped' && groups ? (
            /* GROUPED VIEW */
            groups.map((group) => {
              const collapsed = collapsedGroups.has(group.name);
              const color = EVENT_COLORS[group.name] || '#71717a';
              return (
                <div key={group.name} className="rounded border border-zinc-800/70 overflow-hidden">
                  <button
                    onClick={() => toggleGroup(group.name)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 bg-zinc-900/60 hover:bg-zinc-900 text-left"
                  >
                    {collapsed ? (
                      <ChevronRight className="h-3 w-3 text-zinc-500 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-zinc-500 shrink-0" />
                    )}
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-mono text-[10px] text-zinc-300 font-medium">
                      {group.name}
                    </span>
                    <Badge variant="outline" className="ml-auto border-zinc-700 text-[9px] text-zinc-500">
                      {group.entries.length}
                    </Badge>
                  </button>
                  {!collapsed && (
                    <div className="flex flex-col gap-1 p-1.5 pt-0">
                      {group.entries.slice().reverse().map((entry) => (
                        <EventRow key={entry.id} entry={entry} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            /* FLAT VIEW */
            visible.map((entry) => (
              <EventRow key={entry.id} entry={entry} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* emit console */}
      <div className="shrink-0 border-t border-zinc-800 p-2">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Emit into app
        </div>
        <div className="flex gap-1.5">
          <Select
            value={emitName}
            onValueChange={(v) => {
              setEmitName(v);
              const preset = EMITTABLE_EVENTS.find((e) => e.name === v);
              if (preset) setEmitPayload(preset.payload);
              setEmitError(null);
            }}
          >
            <SelectTrigger className="h-8 flex-1 border-zinc-800 bg-zinc-900 font-mono text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900">
              {EMITTABLE_EVENTS.map((e) => (
                <SelectItem key={e.name} value={e.name} className="font-mono text-[11px]">
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={sendEmit} className="h-8 px-2.5 text-xs">
            <Send className="mr-1 h-3 w-3" /> Send
          </Button>
        </div>
        <Textarea
          value={emitPayload}
          onChange={(e) => setEmitPayload(e.target.value)}
          spellCheck={false}
          className="mt-1.5 h-20 resize-none border-zinc-800 bg-zinc-900 font-mono text-[10px] leading-snug text-zinc-300"
        />
        {emitError && (
          <p className="mt-1 font-mono text-[10px] text-red-400">JSON error: {emitError}</p>
        )}
      </div>
    </div>
  );
}