import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  buildIframeUrl,
  defaultConfig,
  isBridgeEvent,
  isDevkitControlMessage,
  toWireConfig,
  type BridgeLogEntry,
  type DevkitConfig,
  type DevkitPreset,
  type MockState,
} from '@/lib/devkit';

const PRESETS_KEY = 'tma-devkit:presets';
const PRESET_ACTIVE_KEY = 'tma-devkit:active-preset';

interface DevkitContextValue {
  config: DevkitConfig;
  setConfig: (updater: (c: DevkitConfig) => DevkitConfig) => void;
  loadConfig: (c: DevkitConfig) => void;
  iframeUrl: string;
  connected: boolean;
  mockState: MockState | null;
  appUrl: string | null;
  logs: BridgeLogEntry[];
  paused: boolean;
  setPaused: (v: boolean) => void;
  filter: string;
  setFilter: (v: string) => void;
  autoscroll: boolean;
  setAutoscroll: (v: boolean) => void;
  clearLogs: () => void;
  apply: () => void;
  pushLive: () => void;
  emitEvent: (eventType: string, eventData: unknown) => void;
  setIframeEl: (el: HTMLIFrameElement | null) => void;
  reloadKey: number;
  /* Presets */
  presets: DevkitPreset[];
  savePreset: (name: string, desc?: string) => void;
  deletePreset: (id: string) => void;
  loadPreset: (id: string) => void;
}

const DevkitContext = createContext<DevkitContextValue | null>(null);

let logId = 0;
const MAX_LOGS = 500;

function loadPresetsFromStorage(): DevkitPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresetsToStorage(presets: DevkitPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch { /* quota exceeded — silently ignore */ }
}

function loadActivePreset(): DevkitConfig | null {
  try {
    const raw = localStorage.getItem(PRESET_ACTIVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function DevkitProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<DevkitConfig>(() => loadActivePreset() ?? defaultConfig());
  const [reloadKey, setReloadKey] = useState(0);
  const [iframeUrl, setIframeUrl] = useState(() => buildIframeUrl(loadActivePreset() ?? defaultConfig()));
  const [connected, setConnected] = useState(false);
  const [mockState, setMockState] = useState<MockState | null>(null);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<BridgeLogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [autoscroll, setAutoscroll] = useState(true);
  const [presets, setPresets] = useState<DevkitPreset[]>(loadPresetsFromStorage);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const configRef = useRef(config);
  configRef.current = config;
  const presetsRef = useRef(presets);
  presetsRef.current = presets;

  const appendLog = useCallback((dir: 'out' | 'in', eventType: string, data: unknown) => {
    if (pausedRef.current) return;
    setLogs((prev) => {
      const next = [...prev, { id: ++logId, ts: Date.now(), dir, eventType, data }];
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
    });
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      if (event.source !== iframe.contentWindow) return;
      let parsed: unknown;
      try {
        parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (isDevkitControlMessage(parsed)) {
        if (parsed.type === 'hello') {
          setConnected(true);
          setMockState(parsed.state ?? null);
          setAppUrl(parsed.url ?? null);
        } else if (parsed.type === 'ack') {
          setMockState(parsed.state ?? null);
        }
        return;
      }
      if (isBridgeEvent(parsed)) {
        appendLog('out', parsed.eventType, parsed.eventData ?? null);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [appendLog]);

  const setConfig = useCallback((updater: (c: DevkitConfig) => DevkitConfig) => {
    setConfigState((prev) => updater(prev));
  }, []);

  const loadConfig = useCallback((c: DevkitConfig) => {
    setConfigState(c);
    setConnected(false);
    setMockState(null);
    setAppUrl(null);
    setIframeUrl(buildIframeUrl(c));
    setReloadKey((k) => k + 1);
    try { localStorage.setItem(PRESET_ACTIVE_KEY, JSON.stringify(c)); } catch {}
  }, []);

  const apply = useCallback(() => {
    setConnected(false);
    setMockState(null);
    setAppUrl(null);
    setIframeUrl(buildIframeUrl(configRef.current));
    setReloadKey((k) => k + 1);
    try { localStorage.setItem(PRESET_ACTIVE_KEY, JSON.stringify(configRef.current)); } catch {}
  }, []);

  const pushLive = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    const c = configRef.current;
    iframe.contentWindow.postMessage(
      JSON.stringify({
        source: 'tma-devkit',
        type: 'setConfig',
        config: {
          colorScheme: c.colorScheme,
          themeParams: c.themeParams,
          viewport: {
            height: c.viewport.height,
            isExpanded: c.viewport.isExpanded,
          },
        },
      }),
      '*',
    );
  }, []);

  const emitEvent = useCallback(
    (eventType: string, eventData: unknown) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;
      iframe.contentWindow.postMessage(JSON.stringify({ eventType, eventData }), '*');
      appendLog('in', eventType, eventData ?? null);
    },
    [appendLog],
  );

  const setIframeEl = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  /* Presets */
  const savePreset = useCallback((name: string, desc?: string) => {
    const p: DevkitPreset = {
      id: crypto.randomUUID(),
      name,
      description: desc,
      config: JSON.parse(JSON.stringify(configRef.current)),
      createdAt: Date.now(),
    };
    setPresets((prev) => {
      const next = [...prev, p];
      savePresetsToStorage(next);
      presetsRef.current = next;
      return next;
    });
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => {
      const next = prev.filter((pp) => pp.id !== id);
      savePresetsToStorage(next);
      presetsRef.current = next;
      return next;
    });
  }, []);

  const loadPreset = useCallback((id: string) => {
    const p = presetsRef.current.find((pp) => pp.id === id);
    if (!p) return;
    loadConfig(p.config);
  }, [loadConfig]);

  const value = useMemo<DevkitContextValue>(
    () => ({
      config, setConfig, loadConfig, iframeUrl, connected, mockState, appUrl, logs, paused,
      setPaused, filter, setFilter, autoscroll, setAutoscroll, clearLogs, apply, pushLive,
      emitEvent, setIframeEl, reloadKey,
      presets, savePreset, deletePreset, loadPreset,
    }),
    [
      config, setConfig, loadConfig, iframeUrl, connected, mockState, appUrl, logs, paused,
      filter, autoscroll, clearLogs, apply, pushLive, emitEvent, setIframeEl, reloadKey,
      presets, savePreset, deletePreset, loadPreset,
    ],
  );

  return <DevkitContext.Provider value={value}>{children}</DevkitContext.Provider>;
}

export function useDevkit(): DevkitContextValue {
  const ctx = useContext(DevkitContext);
  if (!ctx) throw new Error('useDevkit must be used inside <DevkitProvider>');
  return ctx;
}

export { toWireConfig };