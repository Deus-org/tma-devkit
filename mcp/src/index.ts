#!/usr/bin/env node
/**
 * TMA DevKit — MCP Server
 * 
 * Provides AI assistants (Cursor, Claude) with tools to debug
 * Telegram Mini Apps via Playwright headless browser automation.
 * 
 * Cursor config (.cursor/mcp.json):
 *   { "mcpServers": { "tma-devkit": { "command": "node", "args": [".../mcp/dist/index.js"] } } }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ---- Paths ----
const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SCRIPT_PATH = resolve(__dirname, "..", "..", "public", "tma-devkit.js");

// ---- Types ----
interface BridgeEvent {
  type: string;
  dir: 'out' | 'in';
  ts: number;
  data: unknown;
}

interface LaunchSession {
  url: string;
  scenario: string;
  events: BridgeEvent[];
  launchedAt: number;
  browser: Browser | null;
  page: Page | null;
}

const session: LaunchSession = {
  url: '', scenario: '', events: [], launchedAt: 0,
  browser: null, page: null,
};

// ---- Analyzer ----
function lightAnalyze(events: BridgeEvent[]): string[] {
  const warnings: string[] = [];
  const outEvts = events.filter(e => e.dir === 'out');
  const inEvts = events.filter(e => e.dir === 'in');

  // 1. Duplicate expand() calls
  const expandCount = outEvts.filter(e => e.type === 'web_app_expand').length;
  if (expandCount > 1) warnings.push(`⚠️ web_app_expand called ${expandCount}× — possible re-render loop`);

  // 2. MainButton configured but never pressed
  if (outEvts.some(e => e.type === 'web_app_setup_main_button') && !inEvts.some(e => e.type === 'main_button_pressed'))
    warnings.push('⚠️ MainButton.setParams() called but main_button_pressed never received — MainButton.show() may be missing');

  // 3. showPopup without popupClosed
  if (outEvts.some(e => e.type === 'web_app_open_popup') && !inEvts.some(e => e.type === 'popup_closed'))
    warnings.push('⚠️ showPopup called but popupClosed never received — user input may be lost');

  // 4. sendData near-empty
  for (const e of outEvts.filter(e => e.type === 'web_app_data_send')) {
    if (typeof e.data === 'string' && e.data.length < 3) { warnings.push('⚠️ sendData with near-empty payload'); break; }
  }

  // 5. close() <2s
  const firstTs = events[0]?.ts ?? Date.now();
  for (const e of outEvts.filter(e => e.type === 'web_app_close')) {
    if (e.ts - firstTs < 2000) { warnings.push('❌ web_app_close called <2s after launch'); break; }
  }

  // 6. ready() never called
  if (!outEvts.some(e => e.type === 'web_app_ready'))
    warnings.push('❌ WebApp.ready() was never called — loading spinner may persist forever');

  // 7. ready() called late (after 5+ other API calls)
  const readyIdx = outEvts.findIndex(e => e.type === 'web_app_ready');
  if (readyIdx > 5)
    warnings.push(`⚠️ ready() called after ${readyIdx} other API calls — user sees spinner longer than necessary`);

  // 8. Excessive setHeaderColor (>4)
  const headerColorCount = outEvts.filter(e => e.type === 'web_app_set_header_color').length;
  if (headerColorCount >= 4)
    warnings.push(`⚠️ setHeaderColor called ${headerColorCount}× — possible theme flicker`);

  // 9. HapticFeedback without incoming events
  const hapticCount = outEvts.filter(e => e.type === 'web_app_trigger_haptic_feedback').length;
  if (hapticCount >= 3 && inEvts.length === 0)
    warnings.push(`⚠️ HapticFeedback triggered ${hapticCount}× without user interaction`);

  return warnings;
}

// ---- Scenarios ----
const SCENARIO_PRESETS: Record<string, { platform: string; version: string; colorScheme: string; isPremium: boolean; viewportW: number; viewportH: number }> = {
  'premium-ios': { platform: 'ios', version: '8.0', colorScheme: 'dark', isPremium: true, viewportW: 390, viewportH: 844 },
  'free-android': { platform: 'android', version: '8.0', colorScheme: 'light', isPremium: false, viewportW: 360, viewportH: 800 },
  'desktop': { platform: 'tdesktop', version: '8.0', colorScheme: 'dark', isPremium: true, viewportW: 1200, viewportH: 800 },
  'default': { platform: 'ios', version: '8.0', colorScheme: 'dark', isPremium: true, viewportW: 390, viewportH: 844 },
};
const getScenario = (n: string) => SCENARIO_PRESETS[n] ?? SCENARIO_PRESETS['default'];

// ---- Mock script loader ----
let mockScriptCache: string | null = null;
function getMock(): string {
  if (mockScriptCache) return mockScriptCache;
  try { mockScriptCache = readFileSync(MOCK_SCRIPT_PATH, 'utf-8'); } catch { mockScriptCache = ''; }
  return mockScriptCache;
}

// ---- Base64url encoder (browser-compatible) ----
function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- Headless launch ----
async function launchHeadless(url: string, scenarioName: string, waitMs: number): Promise<{ events: BridgeEvent[]; error?: string }> {
  const preset = getScenario(scenarioName);
  const config = {
    platform: preset.platform, version: preset.version, colorScheme: preset.colorScheme,
    themeParams: preset.colorScheme === 'dark'
      ? { bg_color: '#17212b', text_color: '#f5f5f5', hint_color: '#708499', link_color: '#6ab2f2', button_color: '#5288c1', button_text_color: '#ffffff', secondary_bg_color: '#232e3c', header_bg_color: '#17212b', bottom_bar_bg_color: '#232e3c', accent_text_color: '#6ab2f2', section_bg_color: '#17212b', section_header_text_color: '#6ab2f2', section_separator_color: '#111921', subtitle_text_color: '#708499', destructive_text_color: '#ff595a' }
      : { bg_color: '#ffffff', text_color: '#000000', hint_color: '#999999', link_color: '#2481cc', button_color: '#5288c1', button_text_color: '#ffffff', secondary_bg_color: '#f1f1f1', header_bg_color: '#ffffff', bottom_bar_bg_color: '#e4e4e4', accent_text_color: '#168acd', section_bg_color: '#ffffff', section_header_text_color: '#168acd', section_separator_color: '#d9d9d9', subtitle_text_color: '#999999', destructive_text_color: '#c70000' },
    user: { id: 424242, first_name: 'Test', last_name: 'User', username: 'test_dev', language_code: 'en', is_premium: preset.isPremium },
    botToken: '123456789:DEVKIT_TEST_TOKEN',
    viewport: { height: preset.viewportH, stableHeight: preset.viewportH, isExpanded: true },
  };
  const encoded = base64UrlEncode(JSON.stringify(config));
  const launchUrl = url.includes('#') ? `${url.split('#')[0]}#tma_devkit=${encoded}` : `${url}#tma_devkit=${encoded}`;

  const mockScript = getMock();
  if (!mockScript) return { events: [], error: `Mock script not found at ${MOCK_SCRIPT_PATH}` };

  const collectorScript = `
    window.__tmaDevkitEvents__ = [];
    window.addEventListener('DOMContentLoaded', function() {
      var TgWebView = (window.Telegram && window.Telegram.WebView) || {};
      var origReceive = TgWebView.receiveEvent;
      TgWebView.receiveEvent = function(eventType, eventData) {
        window.__tmaDevkitEvents__.push({ type: eventType, dir: 'in', ts: Date.now(), data: eventData || {} });
        if (origReceive) return origReceive.call(this, eventType, eventData);
      };
      var origPost = TgWebView.postEvent;
      if (origPost) {
        TgWebView.postEvent = function(eventType, eventData, onComplete) {
          window.__tmaDevkitEvents__.push({ type: eventType, dir: 'out', ts: Date.now(), data: eventData || {} });
          return origPost.call(this, eventType, eventData, onComplete);
        };
      }
    });
  `;

  let browser: Browser | null = null;
  let page: Page | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setViewportSize({ width: preset.viewportW, height: preset.viewportH });
    await page.addInitScript({ content: mockScript });
    await page.addInitScript({ content: collectorScript });
    await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(waitMs);
    const events: BridgeEvent[] = await page.evaluate(() => (window as unknown as { __tmaDevkitEvents__?: BridgeEvent[] }).__tmaDevkitEvents__ || []);
    session.browser = browser;
    session.page = page;
    return { events };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    try { await page?.close(); } catch {}
    try { await browser?.close(); } catch {}
    return { events: [], error: `Headless launch failed: ${message}` };
  }
}

async function closeSession() {
  try { await session.page?.close(); } catch {}
  try { await session.browser?.close(); } catch {}
  session.browser = null;
  session.page = null;
}

// ---- MCP Server ----

export function createServer(): McpServer {
  const server = new McpServer({ name: "tma-devkit-mcp", version: "0.1.0" });

  // devkit_launch
  server.registerTool(
    "devkit_launch",
    {
      description: "Launch a Telegram Mini App in a headless browser with TMA DevKit emulation. Collects all bridge events automatically.",
      inputSchema: {
        url: z.string().describe("The Mini App URL to test"),
        scenario: z.enum(["premium-ios", "free-android", "desktop", "default"]).optional().default("default"),
        waitMs: z.number().optional().default(3000).describe("Wait time for events (ms)"),
      },
    },
    async ({ url, scenario, waitMs }) => {
      await closeSession();
      const result = await launchHeadless(url, scenario, waitMs);
      if (result.error) return { content: [{ type: "text", text: `❌ ${result.error}` }] };

      const preset = getScenario(scenario);
      session.url = url;
      session.scenario = `${preset.platform} ${preset.colorScheme} · ${preset.isPremium ? 'Premium' : 'Free'} User`;
      session.events = result.events;
      session.launchedAt = Date.now();

      const lines = result.events.slice(0, 30).map(e => `[${new Date(e.ts).toISOString().replace('T',' ').slice(0,23)}] ${e.dir==='out'?'OUT':'IN '} ${e.type}`);
      const tail = result.events.length > 30 ? `\n... and ${result.events.length - 30} more` : '';
      return { content: [{ type: "text", text: `✅ Launched ${url} (${scenario}). ${result.events.length} events:\n${lines.join('\n')}${tail}\n\nUse devkit_analyze for issues.` }] };
    }
  );

  // devkit_get_events
  server.registerTool(
    "devkit_get_events",
    {
      description: "Retrieve bridge events from the last launch.",
      inputSchema: {
        filter: z.string().optional(),
        limit: z.number().optional().default(50),
      },
    },
    async ({ filter, limit }) => {
      if (!session.events.length) return { content: [{ type: "text", text: "No events. Run devkit_launch first." }] };
      let events = session.events;
      if (filter) { const f = filter.toLowerCase(); events = events.filter(e => e.type.toLowerCase().includes(f)); }
      events = events.slice(-limit);
      const lines = events.map(e => `[${new Date(e.ts).toISOString().replace('T',' ').slice(0,23)}] ${e.dir==='out'?'OUT':'IN '} ${e.type} ${JSON.stringify(e.data)}`);
      return { content: [{ type: "text", text: `Events (${events.length}):\n${lines.join('\n')}` }] };
    }
  );

  // devkit_analyze
  server.registerTool(
    "devkit_analyze",
    {
      description: "Analyze collected events for common Mini App bugs.",
      inputSchema: {},
    },
    async () => {
      if (!session.events.length) return { content: [{ type: "text", text: "No events. Run devkit_launch first." }] };
      const warnings = lightAnalyze(session.events);
      const stats = new Map<string, number>();
      for (const e of session.events) stats.set(e.type, (stats.get(e.type) || 0) + 1);
      const statLines = Array.from(stats.entries()).sort((a,b) => b[1] - a[1]).map(([n,c]) => `  ${n}: ${c}`);
      const text = [`Analysis for ${session.url} (${session.scenario})`, `Events: ${session.events.length}`, '', warnings.length ? `⚠️ Warnings (${warnings.length}):\n${warnings.join('\n')}` : '✅ No issues detected.', '', 'Event breakdown:', ...statLines].join('\n');
      return { content: [{ type: "text", text }] };
    }
  );

  // devkit_emit
  server.registerTool(
    "devkit_emit",
    {
      description: "Emit a client→app event into the live page.",
      inputSchema: {
        eventType: z.string().describe("Event type (e.g., theme_changed, main_button_pressed)"),
        payload: z.string().optional().describe("JSON payload"),
      },
    },
    async ({ eventType, payload }) => {
      try {
        const data = payload ? JSON.parse(payload) : {};
        if (session.page && !session.page.isClosed()) {
          await session.page.evaluate(({ type, data }: { type: string; data: unknown }) => {
            const w = window as unknown as { Telegram?: { WebView?: { receiveEvent?: (t: string, d: unknown) => void } } };
            w.Telegram?.WebView?.receiveEvent?.(type, data);
          }, { type: eventType, data });
        }
        session.events.push({ type: eventType, dir: 'in', ts: Date.now(), data });
        return { content: [{ type: "text", text: `✅ "${eventType}" emitted.` }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `❌ ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );

  // devkit_get_state
  server.registerTool(
    "devkit_get_state",
    {
      description: "Get current session state.",
      inputSchema: {},
    },
    async () => {
      if (!session.url) return { content: [{ type: "text", text: "No active session." }] };
      const elapsed = Date.now() - session.launchedAt;
      return { content: [{ type: "text", text: [`URL: ${session.url}`, `Scenario: ${session.scenario}`, `Events: ${session.events.length}`, `Duration: ${(elapsed/1000).toFixed(1)}s`, `Browser: ${session.page && !session.page.isClosed() ? 'open' : 'closed'}`].join('\n') }] };
    }
  );

  // devkit_close
  server.registerTool(
    "devkit_close",
    {
      description: "Close browser session.",
      inputSchema: {},
    },
    async () => {
      await closeSession();
      return { content: [{ type: "text", text: "✅ Browser closed." }] };
    }
  );

  return server;
}

// ---- Entry point ----
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('TMA DevKit MCP Server running');
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});