import { useState, useCallback, useRef, useEffect } from 'react';
import { DevkitProvider } from '@/hooks/useDevkit';
import { ConfigPanel } from '@/sections/ConfigPanel';
import { DeviceStage } from '@/sections/DeviceStage';
import { EventInspector } from '@/sections/EventInspector';
import { Button } from '@/components/ui/button';
import { Satellite, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Github } from 'lucide-react';

function ResizeHandle({
  onResize,
  axis,
}: {
  onResize: (delta: number) => void;
  axis: 'x' | 'y';
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start = 0;

    function onDown(e: MouseEvent) {
      e.preventDefault();
      start = axis === 'x' ? e.clientX : e.clientY;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    }

    function onMove(e: MouseEvent) {
      const delta = (axis === 'x' ? e.clientX : e.clientY) - start;
      start = axis === 'x' ? e.clientX : e.clientY;
      onResize(delta);
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    el.addEventListener('mousedown', onDown);
    return () => el.removeEventListener('mousedown', onDown);
  }, [onResize, axis]);

  return (
    <div
      ref={ref}
      className={`shrink-0 bg-zinc-800 hover:bg-sky-600 transition-colors cursor-${axis === 'x' ? 'col' : 'row'}-resize active:bg-sky-500 select-none ${
        axis === 'x' ? 'w-1' : 'h-1'
      }`}
    />
  );
}

function DevkitUI() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftW, setLeftW] = useState(290);
  const [rightW, setRightW] = useState(330);

  const onResizeLeft = useCallback((delta: number) => {
    setLeftW((w) => Math.max(220, Math.min(480, w + delta)));
  }, []);
  const onResizeRight = useCallback((delta: number) => {
    setRightW((w) => Math.max(240, Math.min(520, w + delta)));
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-200">
      {/* top bar */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3">
        <Satellite className="h-4 w-4 text-sky-400" />
        <span className="text-[13px] font-semibold tracking-tight text-zinc-100">
          TMA DevKit
        </span>
        <span className="text-[10px] text-zinc-600 hidden sm:inline">
          Telegram Mini Apps emulator & bridge inspector
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLeftOpen((v) => !v)}
            className="h-7 px-1.5 text-zinc-500 hover:text-zinc-300"
            title={leftOpen ? 'Hide config panel' : 'Show config panel'}
          >
            {leftOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRightOpen((v) => !v)}
            className="h-7 px-1.5 text-zinc-500 hover:text-zinc-300"
            title={rightOpen ? 'Hide inspector' : 'Show inspector'}
          >
            {rightOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
          </Button>
          <a
            href="https://core.telegram.org/bots/webapps"
            target="_blank"
            rel="noreferrer"
            className="ml-1 text-[11px] text-zinc-500 hover:text-sky-400 transition-colors"
          >
            docs ↗
          </a>
          <a
            href="https://github.com/Deus-org/tma-devkit"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title="GitHub"
          >
            <Github className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {/* three zones with resize handles */}
      <div className="flex min-h-0 flex-1">
        {/* left panel */}
        {leftOpen && (
          <>
            <aside style={{ width: leftW }} className="shrink-0 border-r border-zinc-800 bg-zinc-900">
              <ConfigPanel />
            </aside>
            <ResizeHandle onResize={onResizeLeft} axis="x" />
          </>
        )}

        {/* main stage */}
        <main className="min-w-0 flex-1">
          <DeviceStage />
        </main>

        {/* right panel */}
        {rightOpen && (
          <>
            <ResizeHandle onResize={(d) => onResizeRight(-d)} axis="x" />
            <aside style={{ width: rightW }} className="shrink-0 border-l border-zinc-800 bg-zinc-900">
              <EventInspector />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <DevkitProvider>
      <DevkitUI />
    </DevkitProvider>
  );
}