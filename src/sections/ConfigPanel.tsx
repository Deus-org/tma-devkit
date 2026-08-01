import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useDevkit } from '@/hooks/useDevkit';
import {
  PLATFORMS,
  THEME_DARK,
  THEME_LIGHT,
  VIEWPORT_PRESETS,
  buildIframeUrl,
  type DevkitConfig,
} from '@/lib/devkit';
import {
  Bookmark,
  Check,
  Cloud,
  Copy,
  FileDown,
  FlaskConical,
  Globe,
  Key,
  Laptop,
  MonitorSmartphone,
  Play,
  Plus,
  Radio,
  Save,
  Smartphone,
  Star,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
} from 'lucide-react';

const THEME_KEYS = [
  'bg_color', 'text_color', 'hint_color', 'link_color', 'button_color',
  'button_text_color', 'secondary_bg_color', 'header_bg_color', 'bottom_bar_bg_color',
  'accent_text_color', 'section_bg_color', 'section_header_text_color',
  'section_separator_color', 'subtitle_text_color', 'destructive_text_color',
];

interface QuickScenario {
  id: string;
  icon: React.ReactNode;
  name: string;
  desc: string;
  apply: (base: DevkitConfig) => DevkitConfig;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
      {children}
    </div>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  switch (platform) {
    case 'ios': return <Smartphone className="h-3 w-3" />;
    case 'android': case 'android_x': return <MonitorSmartphone className="h-3 w-3" />;
    case 'tdesktop': case 'macos': return <Laptop className="h-3 w-3" />;
    default: return <Globe className="h-3 w-3" />;
  }
}

export function ConfigPanel() {
  const {
    config, setConfig, loadConfig, apply, pushLive, connected,
    presets, savePreset, deletePreset, loadPreset,
  } = useDevkit();

  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDesc, setPresetDesc] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [csDialogOpen, setCsDialogOpen] = useState(false);
  const [cloudKeys, setCloudKeys] = useState<Array<{ key: string; value: string }>>([]);

  function loadCloudKeys() {
    const prefix = 'tma-devkit:cloud:';
    const keys: Array<{ key: string; value: string }> = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          keys.push({ key: k.slice(prefix.length), value: localStorage.getItem(k) ?? '' });
        }
      }
    } catch { /* storage read may fail in sandboxed contexts */ }
    setCloudKeys(keys);
  }
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');

  const patch = (p: Partial<DevkitConfig>) => setConfig((c) => ({ ...c, ...p }));
  const patchUser = (p: Partial<DevkitConfig['user']>) =>
    setConfig((c) => ({ ...c, user: { ...c.user, ...p } }));
  const patchTheme = (key: string, value: string) =>
    setConfig((c) => ({ ...c, themeParams: { ...c.themeParams, [key]: value } }));

  const snippet = `<script src="${window.location.origin}/tma-devkit.js"></script>`;
  const configJson = JSON.stringify(config, null, 2);

  function copyText(text: string, which: 'snippet' | 'url') {
    navigator.clipboard?.writeText(text).then(() => {
      if (which === 'snippet') { setCopied(true); setTimeout(() => setCopied(false), 1200); }
      else { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 1200); }
    });
  }

  function exportJson() {
    const blob = new Blob([configJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tma-devkit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (parsed.url && parsed.platform) loadConfig(parsed as DevkitConfig);
      } catch { /* invalid */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function doSavePreset() {
    if (!presetName.trim()) return;
    savePreset(presetName.trim(), presetDesc.trim() || undefined);
    setPresetName('');
    setPresetDesc('');
    setDialogOpen(false);
  }

  const quickScenarios = useMemo<QuickScenario[]>(() => [
    {
      id: 'premium-ios',
      icon: <Star className="h-3.5 w-3.5 text-amber-400" />,
      name: 'Premium User · iOS',
      desc: 'Telegram Premium, iPhone 14, dark theme',
      apply: (b) => ({
        ...b, platform: 'ios', colorScheme: 'dark',
        themeParams: { ...THEME_DARK },
        user: { ...b.user, is_premium: true },
        viewport: { width: 390, height: 844, isExpanded: true },
      }),
    },
    {
      id: 'free-android',
      icon: <User className="h-3.5 w-3.5 text-zinc-400" />,
      name: 'Free User · Android',
      desc: 'No premium, Android, light theme',
      apply: (b) => ({
        ...b, platform: 'android', colorScheme: 'light',
        themeParams: { ...THEME_LIGHT },
        user: { ...b.user, is_premium: false },
        viewport: { width: 360, height: 800, isExpanded: true },
      }),
    },
    {
      id: 'new-user',
      icon: <UserPlus className="h-3.5 w-3.5 text-emerald-400" />,
      name: 'New User · start_param',
      desc: 'First open with referral param & expanded view',
      apply: (b) => ({
        ...b, startParam: 'ref=invite&src=share',
        viewport: { ...b.viewport, isExpanded: true },
      }),
    },
    {
      id: 'group-chat',
      icon: <Users className="h-3.5 w-3.5 text-blue-400" />,
      name: 'Group Chat Launch',
      desc: 'App opened from group, chat_id in context',
      apply: (b) => ({
        ...b, user: { ...b.user, id: 777000, first_name: 'Group', last_name: 'Context', username: 'group_bot' },
      }),
    },
    {
      id: 'desktop',
      icon: <Laptop className="h-3.5 w-3.5 text-purple-400" />,
      name: 'Desktop · tDesktop',
      desc: 'Wide viewport, web platform',
      apply: (b) => ({
        ...b, platform: 'tdesktop',
        viewport: { width: 1200, height: 800, isExpanded: true },
      }),
    },
  ], []);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-3">

        {/* Quick Scenarios */}
        <div className="flex flex-col gap-1.5">
          <SectionTitle>Quick scenarios</SectionTitle>
          <div className="flex flex-col gap-1">
            {quickScenarios.map((sc) => (
              <button
                key={sc.id}
                onClick={() => loadConfig(sc.apply({ ...config }))}
                className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                {sc.icon}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-zinc-300">{sc.name}</div>
                  <div className="text-[10px] text-zinc-600 truncate">{sc.desc}</div>
                </div>
                <FlaskConical className="h-3 w-3 shrink-0 text-zinc-700" />
              </button>
            ))}
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Saved Presets */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <SectionTitle>Saved presets</SectionTitle>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-zinc-500 hover:text-zinc-300">
                  <Save className="mr-1 h-3 w-3" /> Save current
                </Button>
              </DialogTrigger>
              <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-sm text-zinc-200">Save preset</DialogTitle>
                  <DialogDescription className="text-xs text-zinc-500">
                    Store the current config as a reusable preset.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  placeholder="Preset name"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200"
                  onKeyDown={(e) => e.key === 'Enter' && doSavePreset()}
                />
                <Input
                  placeholder="Description (optional)"
                  value={presetDesc}
                  onChange={(e) => setPresetDesc(e.target.value)}
                  className="h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200"
                />
                <DialogFooter>
                  <Button size="sm" onClick={doSavePreset} className="h-8 text-xs">
                    <Plus className="mr-1 h-3 w-3" /> Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {presets.length === 0 ? (
            <p className="text-[10px] text-zinc-700 px-1">
              No saved presets. Set up a config and save it for quick switching.
            </p>
          ) : (
            <div className="flex flex-col gap-1 max-h-[120px] overflow-auto">
              {presets.map((p) => (
                <div key={p.id} className="flex items-center gap-1.5 rounded border border-zinc-800/50 bg-zinc-900/40 px-2 py-1.5">
                  <Bookmark className="h-3 w-3 shrink-0 text-zinc-600" />
                  <div className="min-w-0 flex-1" onClick={() => loadPreset(p.id)} role="button" tabIndex={0}>
                    <div className="text-[11px] text-zinc-300 truncate">{p.name}</div>
                    {p.description && <div className="text-[9px] text-zinc-600 truncate">{p.description}</div>}
                    <div className="text-[9px] text-zinc-700">{p.config.platform} · {p.config.colorScheme}</div>
                  </div>
                  <button onClick={() => loadPreset(p.id)} className="rounded p-0.5 text-zinc-500 hover:text-zinc-300" title="Load">
                    <Play className="h-3 w-3" />
                  </button>
                  <button onClick={() => deletePreset(p.id)} className="rounded p-0.5 text-zinc-600 hover:text-red-400" title="Delete">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator className="bg-zinc-800" />

        {/* App URL */}
        <div className="flex flex-col gap-2">
          <SectionTitle>Mini app</SectionTitle>
          <Label className="text-xs text-zinc-400">App URL</Label>
          <Input
            value={config.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="/demo/ or https://localhost:5173/"
            className="h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={apply} className="h-8 flex-1 text-xs">
              <Play className="mr-1 h-3 w-3" /> Apply & reload
            </Button>
            <Button
              size="sm" variant="outline" onClick={pushLive} disabled={!connected}
              title={connected ? 'Push theme/viewport live' : 'Connect first (Apply)'}
              className="h-8 flex-1 border-zinc-700 text-xs"
            >
              <Radio className="mr-1 h-3 w-3" /> Push live
            </Button>
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Platform & version */}
        <div className="flex flex-col gap-2">
          <SectionTitle>Client</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-zinc-400">Platform</Label>
              <Select value={config.platform} onValueChange={(v) => patch({ platform: v })}>
                <SelectTrigger className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-900">
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      <span className="flex items-center gap-1.5"><PlatformIcon platform={p} />{p}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Bot API ver.</Label>
              <Input value={config.version} onChange={(e) => patch({ version: e.target.value })}
                className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" spellCheck={false} />
            </div>
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Color scheme</Label>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {(['light', 'dark'] as const).map((scheme) => (
                <Button key={scheme} size="sm"
                  variant={config.colorScheme === scheme ? 'default' : 'outline'}
                  className={config.colorScheme === scheme ? 'h-7 text-xs' : 'h-7 border-zinc-700 text-xs text-zinc-400'}
                  onClick={() => {
                    setConfig((c) => ({
                      ...c, colorScheme: scheme,
                      themeParams: { ...(scheme === 'dark' ? THEME_DARK : THEME_LIGHT) },
                    }));
                    // Auto-push theme change to iframe without reload
                    setTimeout(() => pushLive(), 50);
                  }}
                >{scheme}</Button>
              ))}
            </div>
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Viewport */}
        <div className="flex flex-col gap-2">
          <SectionTitle>Viewport</SectionTitle>
          <Select
            value={`${config.viewport.width}x${config.viewport.height}`}
            onValueChange={(v) => {
              const preset = VIEWPORT_PRESETS.find((p) => `${p.width}x${p.height}` === v);
              if (preset) setConfig((c) => ({ ...c, viewport: { ...c.viewport, width: preset.width, height: preset.height } }));
            }}
          >
            <SelectTrigger className="h-8 border-zinc-800 bg-zinc-900 text-xs"><SelectValue placeholder="Custom" /></SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900">
              {VIEWPORT_PRESETS.map((p) => (
                <SelectItem key={p.name} value={`${p.width}x${p.height}`} className="text-xs">{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-zinc-400">Width</Label>
              <Input type="number" value={config.viewport.width}
                onChange={(e) => setConfig((c) => ({ ...c, viewport: { ...c.viewport, width: Number(e.target.value) || 390 } }))}
                className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Height</Label>
              <Input type="number" value={config.viewport.height}
                onChange={(e) => setConfig((c) => ({ ...c, viewport: { ...c.viewport, height: Number(e.target.value) || 800 } }))}
                className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" />
            </div>
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* User */}
        <div className="flex flex-col gap-2">
          <SectionTitle>User (initData)</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-zinc-400">ID</Label>
              <Input type="number" value={config.user.id}
                onChange={(e) => patchUser({ id: Number(e.target.value) || 0 })}
                className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Username</Label>
              <Input value={config.user.username ?? ''}
                onChange={(e) => patchUser({ username: e.target.value })}
                className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" spellCheck={false} />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">First name</Label>
              <Input value={config.user.first_name}
                onChange={(e) => patchUser({ first_name: e.target.value })}
                className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Last name</Label>
              <Input value={config.user.last_name ?? ''}
                onChange={(e) => patchUser({ last_name: e.target.value })}
                className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Lang code</Label>
              <Input value={config.user.language_code ?? ''}
                onChange={(e) => patchUser({ language_code: e.target.value })}
                className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" />
            </div>
            <div className="flex flex-col gap-1 justify-end pb-1">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!config.user.is_premium}
                  onChange={(e) => patchUser({ is_premium: e.target.checked })}
                  className="h-3.5 w-3.5 accent-sky-500" />
                <span className="text-[10px] text-zinc-500">is_premium</span>
              </label>
            </div>
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Photo URL</Label>
            <Input value={config.user.photo_url ?? ''}
              onChange={(e) => patchUser({ photo_url: e.target.value || undefined })}
              placeholder="https://…" className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" spellCheck={false} />
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Bot token (initData signing)</Label>
            <Input value={config.botToken} onChange={(e) => patch({ botToken: e.target.value })}
              className="mt-1 h-8 border-zinc-800 bg-zinc-900 font-mono text-[11px] text-zinc-200" spellCheck={false} />
          </div>
          <div>
            <Label className="text-xs text-zinc-400">start_param</Label>
            <Input value={config.startParam ?? ''}
              onChange={(e) => patch({ startParam: e.target.value })}
              className="mt-1 h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200" spellCheck={false} />
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Cloud Storage Inspector */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <SectionTitle>CloudStorage</SectionTitle>
            <Dialog open={csDialogOpen} onOpenChange={(open) => { if (open) loadCloudKeys(); setCsDialogOpen(open); }}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-zinc-500 hover:text-zinc-300">
                  <Cloud className="mr-1 h-3 w-3" /> Manage keys
                </Button>
              </DialogTrigger>
              <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-sm text-zinc-200">CloudStorage inspector</DialogTitle>
                  <DialogDescription className="text-xs text-zinc-500">
                    This emulates keys that your mini-app would read via <code className="text-[11px] text-sky-400">CloudStorage.getItem</code>.
                    Changes apply on next reload.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 max-h-[300px] overflow-auto">
                  {cloudKeys.length === 0 && <p className="text-xs text-zinc-600 text-center py-4">No keys stored. Add some below.</p>}
                  {cloudKeys.map((kv, i) => (
                    <div key={i} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
                      <Key className="h-3 w-3 shrink-0 text-zinc-600" />
                      <code className="flex-1 text-[10px] text-zinc-300 truncate">{kv.key}</code>
                      <code className="text-[10px] text-zinc-500 truncate max-w-[120px]">{kv.value}</code>
                      <button onClick={() => {
                        localStorage.removeItem('tma-devkit:cloud:' + kv.key);
                        setCloudKeys((prev) => prev.filter((_, j) => j !== i));
                      }} className="text-zinc-600 hover:text-red-400">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input placeholder="key" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
                    className="h-7 flex-1 border-zinc-800 bg-zinc-900 text-[10px] text-zinc-300" spellCheck={false} />
                  <Input placeholder="value" value={newKeyValue} onChange={(e) => setNewKeyValue(e.target.value)}
                    className="h-7 flex-[2] border-zinc-800 bg-zinc-900 text-[10px] text-zinc-300" spellCheck={false} />
                  <Button size="sm" variant="outline" className="h-7 border-zinc-700 text-xs"
                    onClick={() => {
                      if (!newKeyName.trim()) return;
                      setCloudKeys((prev) => [...prev, { key: newKeyName.trim(), value: newKeyValue }]);
                      setNewKeyName(''); setNewKeyValue('');
                    }}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <DialogFooter>
                  <Button size="sm" className="h-8 text-xs"
                    onClick={() => {
                      cloudKeys.forEach((kv) => localStorage.setItem('tma-devkit:cloud:' + kv.key, kv.value));
                      setCsDialogOpen(false);
                    }}>Apply keys</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex items-center gap-1.5 rounded border border-zinc-800/50 bg-zinc-900/40 px-2 py-1.5">
            <Cloud className="h-3 w-3 text-zinc-600" />
            <span className="text-[10px] text-zinc-500">
              {cloudKeys.length > 0 ? `${cloudKeys.length} keys stored — click Manage to edit` : 'No keys — click Manage to add'}
            </span>
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Theme params */}
        <div className="flex flex-col gap-2">
          <SectionTitle>themeParams</SectionTitle>
          <div className="flex flex-col gap-1.5">
            {THEME_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className="h-5 w-5 shrink-0 rounded border border-zinc-700"
                  style={{ backgroundColor: config.themeParams[key] || 'transparent' }} />
                <span className="w-[130px] truncate font-mono text-[10px] text-zinc-500">{key}</span>
                <Input value={config.themeParams[key] ?? ''} onChange={(e) => patchTheme(key, e.target.value)}
                  className="h-7 border-zinc-800 bg-zinc-900 font-mono text-[11px] text-zinc-200" spellCheck={false} />
              </div>
            ))}
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Import / Export */}
        <div className="flex flex-col gap-2">
          <SectionTitle>Import / Export</SectionTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 flex-1 border-zinc-700 text-xs" onClick={exportJson}>
              <FileDown className="mr-1 h-3 w-3" /> Export JSON
            </Button>
            <Button size="sm" variant="outline" className="h-7 flex-1 border-zinc-700 text-xs relative overflow-hidden"
              onClick={() => document.getElementById('config-import')?.click()}>
              <Upload className="mr-1 h-3 w-3" /> Import
            </Button>
            <input id="config-import" type="file" accept=".json" onChange={handleImport} className="hidden" />
          </div>
          <p className="text-[9px] text-zinc-600">Export saves the full config. Import loads it instantly.</p>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Snippet */}
        <div className="flex flex-col gap-2">
          <SectionTitle>Use in your own app</SectionTitle>
          <div className="rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-[10px] leading-relaxed text-zinc-400 break-all">{snippet}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 flex-1 border-zinc-700 text-xs" onClick={() => copyText(snippet, 'snippet')}>
              {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}{copied ? 'Copied' : 'Copy snippet'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 flex-1 border-zinc-700 text-xs" onClick={() => copyText(buildIframeUrl(config), 'url')}>
              {copiedUrl ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}{copiedUrl ? 'Copied' : 'Copy launch URL'}
            </Button>
          </div>
          <p className="text-[10px] leading-snug text-zinc-600">
            The script tag only activates with a devkit config; it is inert otherwise, safe to keep during development.
          </p>
        </div>
        <div className="h-8" />
      </div>
    </ScrollArea>
  );
}