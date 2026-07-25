/**
 * TMA DevKit — shared panel library.
 * Config model, defaults, URL-hash config codec and bridge event catalogs.
 */

export interface DevkitUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
  allows_write_to_pm?: boolean;
  added_to_attachment_menu?: boolean;
}

/** Named preset: a complete DevkitConfig snapshot for one-click switching. */
export interface DevkitPreset {
  id: string;
  name: string;
  description?: string;
  config: DevkitConfig;
  createdAt: number;
}

export interface DevkitViewport {
  width: number;
  height: number;
  isExpanded: boolean;
}

export interface DevkitConfig {
  /** Mini app URL loaded into the iframe. */
  url: string;
  platform: string;
  version: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  user: DevkitUser;
  botToken: string;
  startParam?: string;
  viewport: DevkitViewport;
}

/** What actually travels inside `#tma_devkit=` (no panel-only fields). */
export interface DevkitWireConfig {
  platform: string;
  version: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  user: DevkitUser;
  botToken: string;
  startParam?: string;
  viewport: { height: number; stableHeight: number; isExpanded: boolean };
}

export const THEME_LIGHT: Record<string, string> = {
  bg_color: '#ffffff',
  text_color: '#000000',
  hint_color: '#999999',
  link_color: '#2481cc',
  button_color: '#5288c1',
  button_text_color: '#ffffff',
  secondary_bg_color: '#f1f1f1',
  header_bg_color: '#ffffff',
  bottom_bar_bg_color: '#e4e4e4',
  accent_text_color: '#168acd',
  section_bg_color: '#ffffff',
  section_header_text_color: '#168acd',
  section_separator_color: '#d9d9d9',
  subtitle_text_color: '#999999',
  destructive_text_color: '#c70000',
};

export const THEME_DARK: Record<string, string> = {
  bg_color: '#17212b',
  text_color: '#f5f5f5',
  hint_color: '#708499',
  link_color: '#6ab2f2',
  button_color: '#5288c1',
  button_text_color: '#ffffff',
  secondary_bg_color: '#232e3c',
  header_bg_color: '#17212b',
  bottom_bar_bg_color: '#232e3c',
  accent_text_color: '#6ab2f2',
  section_bg_color: '#17212b',
  section_header_text_color: '#6ab2f2',
  section_separator_color: '#111921',
  subtitle_text_color: '#708499',
  destructive_text_color: '#ff595a',
};

export const PLATFORMS = ['ios', 'android', 'android_x', 'tdesktop', 'web', 'webk', 'weba', 'macos', 'unigram'] as const;

export const VIEWPORT_PRESETS = [
  { name: 'iPhone 14 (390×844)', width: 390, height: 844 },
  { name: 'Android (360×800)', width: 360, height: 800 },
  { name: 'Desktop (1200×800)', width: 1200, height: 800 },
  { name: 'Compact (390×500)', width: 390, height: 500 },
] as const;

export const DEFAULT_BOT_TOKEN = '123456789:DEVKIT_TEST_TOKEN';

export function defaultConfig(): DevkitConfig {
  return {
    url: '/demo/',
    platform: 'ios',
    version: '8.0',
    colorScheme: 'dark',
    themeParams: { ...THEME_DARK },
    user: {
      id: 424242,
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada_dev',
      language_code: 'en',
      is_premium: true,
    },
    botToken: DEFAULT_BOT_TOKEN,
    startParam: undefined,
    viewport: { width: 390, height: 844, isExpanded: true },
  };
}

/* ---------------- base64url config codec ---------------- */

export function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str: string): string {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export function toWireConfig(config: DevkitConfig): DevkitWireConfig {
  return {
    platform: config.platform,
    version: config.version,
    colorScheme: config.colorScheme,
    themeParams: config.themeParams,
    user: config.user,
    botToken: config.botToken,
    ...(config.startParam ? { startParam: config.startParam } : {}),
    viewport: {
      height: config.viewport.height,
      stableHeight: config.viewport.height,
      isExpanded: config.viewport.isExpanded,
    },
  };
}

export function buildIframeUrl(config: DevkitConfig): string {
  const encoded = base64UrlEncode(JSON.stringify(toWireConfig(config)));
  const base = config.url.split('#')[0];
  return `${base}#tma_devkit=${encoded}`;
}

/* ---------------- bridge protocol catalogs ---------------- */

/** Control-channel messages carry this marker and are NOT bridge events. */
export const DEVKIT_SOURCE = 'tma-devkit';

export interface MockState {
  platform: string;
  version: string;
  colorScheme: string;
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  themeParams: Record<string, string>;
}

export interface BridgeLogEntry {
  id: number;
  ts: number;
  /** out = app → client (methods the app called); in = client → app (events we emit). */
  dir: 'out' | 'in';
  eventType: string;
  data: unknown;
}

/** Events the panel can emit INTO the app (client → app, snake_case wire names). */
export const EMITTABLE_EVENTS: { name: string; payload: string }[] = [
  { name: 'theme_changed', payload: '{\n  "theme_params": {\n    "bg_color": "#17212b"\n  }\n}' },
  {
    name: 'viewport_changed',
    payload: '{\n  "height": 700,\n  "is_state_stable": true,\n  "is_expanded": true\n}',
  },
  { name: 'main_button_pressed', payload: '{}' },
  { name: 'secondary_button_pressed', payload: '{}' },
  { name: 'back_button_pressed', payload: '{}' },
  { name: 'settings_button_pressed', payload: '{}' },
  { name: 'invoice_closed', payload: '{\n  "slug": "demoSlug",\n  "status": "paid"\n}' },
  { name: 'popup_closed', payload: '{\n  "button_id": "ok"\n}' },
  { name: 'qr_text_received', payload: '{\n  "data": "https://t.me/devkit"\n}' },
  { name: 'scan_qr_popup_closed', payload: '{}' },
  { name: 'clipboard_text_received', payload: '{\n  "req_id": "?",\n  "data": "pasted text"\n}' },
  { name: 'write_access_requested', payload: '{\n  "status": "allowed"\n}' },
  { name: 'phone_requested', payload: '{\n  "status": "sent"\n}' },
  { name: 'visibility_changed', payload: '{\n  "is_visible": true\n}' },
  { name: 'fullscreen_changed', payload: '{\n  "is_fullscreen": true\n}' },
  { name: 'home_screen_checked', payload: '{\n  "status": "missed"\n}' },
];

export function isDevkitControlMessage(parsed: unknown): parsed is {
  source: typeof DEVKIT_SOURCE;
  type: string;
  url?: string;
  state?: MockState;
} {
  return (
    !!parsed &&
    typeof parsed === 'object' &&
    (parsed as Record<string, unknown>).source === DEVKIT_SOURCE
  );
}

export function isBridgeEvent(parsed: unknown): parsed is { eventType: string; eventData: unknown } {
  return (
    !!parsed &&
    typeof parsed === 'object' &&
    typeof (parsed as Record<string, unknown>).eventType === 'string'
  );
}
