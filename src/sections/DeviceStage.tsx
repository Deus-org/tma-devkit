import { useRef, useState, useEffect } from 'react';
import { useDevkit } from '@/hooks/useDevkit';
import { Badge } from '@/components/ui/badge';
import {
  Globe,
  Laptop,
  MonitorSmartphone,
  RotateCw,
  Smartphone,
  Maximize2,
} from 'lucide-react';

function PlatformIcon({ platform }: { platform: string }) {
  switch (platform) {
    case 'ios': return <Smartphone className="h-3.5 w-3.5" />;
    case 'android': case 'android_x': return <MonitorSmartphone className="h-3.5 w-3.5" />;
    case 'tdesktop': case 'macos': return <Laptop className="h-3.5 w-3.5" />;
    default: return <Globe className="h-3.5 w-3.5" />;
  }
}

function PlatformLabel({ platform }: { platform: string }) {
  const map: Record<string, string> = {
    ios: 'iOS', android: 'Android', android_x: 'Android X',
    tdesktop: 'Desktop', macos: 'macOS', web: 'Web', webk: 'Web K',
    weba: 'Web A', unigram: 'Unigram',
  };
  return <>{map[platform] || platform}</>;
}

export function DeviceStage() {
  const {
    config,
    iframeUrl,
    connected,
    mockState,
    setIframeEl,
    reloadKey,
    apply,
  } = useDevkit();

  const { width, height } = config.viewport;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const isDesktop = width >= 900;

  /* Fit to container */
  useEffect(() => {
    function recalc() {
      if (!containerRef.current) return;
      const cw = containerRef.current.clientWidth - 48;
      const ch = containerRef.current.clientHeight - 48;
      const sw = cw / width;
      const sh = ch / (height + (isDesktop ? 4 : 64));
      setFitScale(Math.min(sw, sh, 1));
    }
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [width, height, isDesktop]);

  const displayScale = scale || fitScale;

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <PlatformIcon platform={config.platform} />
        <span className="font-mono text-[11px] text-zinc-400">
          <PlatformLabel platform={config.platform} />
        </span>
        <span className="text-zinc-700">·</span>
        <span className="max-w-[35%] truncate font-mono text-[11px] text-zinc-500" title={iframeUrl}>
          {iframeUrl}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* Zoom controls */}
          <button
            onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 text-[10px] font-mono"
            title="Zoom out"
          >
            −
          </button>
          <span className="text-[10px] font-mono text-zinc-500 w-10 text-center">
            {Math.round(displayScale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(2, s + 0.25))}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 text-[10px] font-mono"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => setScale(1)}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            title="Reset zoom"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <span className="text-zinc-700">|</span>
          <Badge
            variant="outline"
            className={
              connected
                ? 'border-emerald-800 bg-emerald-950/60 text-emerald-400'
                : 'border-zinc-700 bg-zinc-900 text-zinc-500'
            }
          >
            <span
              className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                connected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
              }`}
            />
            {connected ? 'connected' : 'waiting'}
          </Badge>
          <button
            onClick={apply}
            title="Reload app"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* stage */}
      <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 bg-[#0a0a0a]">
        <div
          className="flex flex-col overflow-hidden border border-zinc-600 bg-black shadow-2xl shadow-black/60 transition-[width,height,border-radius] duration-200"
          style={{
            width: width + (isDesktop ? 4 : 24),
            height: Math.min(height + (isDesktop ? 4 : 64), window.innerHeight - 160),
            borderRadius: isDesktop ? 8 : 28,
            transform: `scale(${displayScale})`,
            transformOrigin: 'center center',
          }}
        >
          {/* mobile notch */}
          {!isDesktop && (
            <div className="flex h-10 shrink-0 items-center justify-center bg-zinc-900 relative">
              <div className="h-1.5 w-16 rounded-full bg-zinc-700" />
              <div className="absolute right-3 top-2.5 flex items-center gap-1">
                <span className="text-[8px] font-semibold text-zinc-500">
                  <PlatformLabel platform={config.platform} />
                </span>
                <span className="text-[8px] text-zinc-600">
                  {config.viewport.width}×{config.viewport.height}
                </span>
              </div>
            </div>
          )}
          {/* desktop title bar */}
          {isDesktop && (
            <div className="flex h-7 shrink-0 items-center gap-1.5 bg-zinc-900 px-3">
              <div className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
              </div>
              <span className="ml-auto font-mono text-[8px] text-zinc-500">
                <PlatformLabel platform={config.platform} /> · {config.viewport.width}×{config.viewport.height}
              </span>
            </div>
          )}
          <iframe
            key={`${reloadKey}:${iframeUrl}`}
            ref={setIframeEl}
            src={iframeUrl}
            title="Mini app under test"
            className="min-h-0 w-full flex-1 border-0"
            style={{ backgroundColor: config.colorScheme === 'light' ? '#ffffff' : '#17212b' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      </div>

      {/* status strip */}
      <div className="flex h-8 shrink-0 items-center gap-4 border-t border-zinc-800 px-3 font-mono text-[10px] text-zinc-500">
        <span className="text-zinc-400">
          {width}×{height}
        </span>
        {mockState ? (
          <>
            <span>v{mockState.version}</span>
            <span className={
              config.colorScheme === 'dark' ? 'text-indigo-400' : 'text-amber-400'
            }>
              {mockState.colorScheme}
            </span>
            <span>vh={Math.round(mockState.viewportHeight)}</span>
            <span className="ml-auto text-zinc-600">
              expanded: {String(mockState.isExpanded)}
            </span>
          </>
        ) : (
          <span className="text-zinc-600">no mock state — app reports in on load</span>
        )}
      </div>
    </div>
  );
}