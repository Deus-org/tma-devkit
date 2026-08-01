#!/usr/bin/env node
/**
 * TMA DevKit — MCP Server
 * 
 * Provides AI assistants (Cline, Cursor, Claude) with tools to debug
 * Telegram Mini Apps by connecting to a live DevKit session or launching
 * a headless one via Playwright.
 * 
 * Cursor config (.cursor/mcp.json):
 *   { "mcpServers": { "tma-devkit": { "command": "node", "args": [".../mcp/dist/index.js"] } } }
 * 
 * Cline config (cline_mcp_settings.json):
 *   { "mcpServers": { "tma-devkit": { "command": "node", "args": [".../mcp/dist/index.js"] } } }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const EVENTS_FILE = ".tma-devkit/events.jsonl";

// ---- Types ----
interface BridgeEvent {
  id: number;
  ts: number;
  dir: "out" | "in";
  eventType: string;
  data: unknown;
}

interface SessionState {
  url: string;
  scenario: string;
  port: number;
  events: BridgeEvent[];
  launchedAt: number;
  browser: Browser | null;
  page: Page | null;
  liveMode: boolean; // true = connected to existing DevKit, false = own headless
}

const session: SessionState = {
  url: "", scenario: "", port: 5188, events: [],
  launchedAt: 0, browser: null, page: null, liveMode: false,
};

// ---- Event reader ----
function readEvents(): BridgeEvent[] {
  const filePath = resolve(process.cwd(), EVENTS_FILE);
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try { return JSON.parse(line) as BridgeEvent; }
        catch { return null; }
      })
      .filter((e): e is BridgeEvent => e !== null);
  } catch {
    return [];
  }
}

// ---- Analyzer ----
function analyzeEvents(events: BridgeEvent[]): string[] {
  const warnings: string[] = [];
  const outEvts = events.filter((e) => e.dir === "out");
  const inEvts = events.filter((e) => e.dir === "in");

  // 1. expand() called multiple times
  const expandCount = outEvts.filter((e) => e.eventType === "web_app_expand").length;
  if (expandCount > 1)
    warnings.push(`⚠️ web_app_expand called ${expandCount}x — possible re-render loop`);

  // 2. MainButton setParams without show()
  if (
    outEvts.some((e) => e.eventType === "web_app_setup_main_button") &&
    !inEvts.some((e) => e.eventType === "main_button_pressed")
  )
    warnings.push("⚠️ MainButton configured but main_button_pressed never received — show() may be missing");

  // 3. showPopup without popupClosed
  if (
    outEvts.some((e) => e.eventType === "web_app_open_popup") &&
    !inEvts.some((e) => e.eventType === "popup_closed")
  )
    warnings.push("⚠️ showPopup called but popupClosed never received — user input lost");

  // 4. sendData near-empty
  for (const e of outEvts.filter((e) => e.eventType === "web_app_data_send")) {
    if (typeof e.data === "string" && (e.data as string).length < 3) {
      warnings.push("⚠️ sendData with near-empty payload");
      break;
    }
  }

  // 5. close() <2s
  const firstTs = events[0]?.ts ?? Date.now();
  for (const e of outEvts.filter((e) => e.eventType === "web_app_close")) {
    if (e.ts - firstTs < 2000) {
      warnings.push("❌ web_app_close called <2s after launch — early exit");
      break;
    }
  }

  // 6. ready() never called
  if (!outEvts.some((e) => e.eventType === "web_app_ready"))
    warnings.push("❌ WebApp.ready() was never called — spinner persists");

  // 7. ready() late (after 5+ calls)
  const readyIdx = outEvts.findIndex((e) => e.eventType === "web_app_ready");
  if (readyIdx > 5)
    warnings.push(`⚠️ ready() called after ${readyIdx} other calls — delayed spinner`);

  // 8. setHeaderColor 4+ times
  const hcCount = outEvts.filter((e) => e.eventType === "web_app_set_header_color").length;
  if (hcCount >= 4)
    warnings.push(`⚠️ setHeaderColor called ${hcCount}x — possible flicker`);

  // 9. HapticFeedback without interaction
  const hapticCount = outEvts.filter((e) => e.eventType === "web_app_trigger_haptic_feedback").length;
  if (hapticCount >= 3 && inEvts.length === 0)
    warnings.push(`⚠️ HapticFeedback ${hapticCount}x without user interaction`);

  return warnings;
}

// ---- Scenario presets ----
const SCENARIOS: Record<string, Record<string, unknown>> = {
  "premium-ios": { platform: "ios", version: "8.0", colorScheme: "dark" as const, isPremium: true, viewportW: 390, viewportH: 844 },
  "free-android": { platform: "android", version: "8.0", colorScheme: "light" as const, isPremium: false, viewportW: 360, viewportH: 800 },
  "desktop": { platform: "tdesktop", version: "8.0", colorScheme: "dark" as const, isPremium: true, viewportW: 1200, viewportH: 800 },
  "default": { platform: "ios", version: "8.0", colorScheme: "dark" as const, isPremium: true, viewportW: 390, viewportH: 844 },
};

// ---- Cleanup ----
async function closeSession() {
  try { await session.page?.close(); } catch { /* ignore */ }
  try { await session.browser?.close(); } catch { /* ignore */ }
  session.browser = null;
  session.page = null;
  session.liveMode = false;
}

// ---- MCP Server ----
function createServer(): McpServer {
  const server = new McpServer({ name: "tma-devkit-mcp", version: "0.2.0" });

  // devkit_launch — starts DevKit via CLI + Playwright
  server.registerTool(
    "devkit_launch",
    {
      description: "Launch a Telegram Mini App in DevKit with Playwright automation. Use this first, then devkit_action to interact, devkit_get_events to collect, devkit_analyze for issues.",
      inputSchema: {
        url: z.string().describe("Mini App URL to test"),
        scenario: z.enum(["premium-ios", "free-android", "desktop", "default"]).optional().default("premium-ios"),
        port: z.number().optional().default(5188).describe("DevKit panel port"),
      },
    },
    async ({ url, scenario, port }) => {
      await closeSession();
      const preset = SCENARIOS[scenario];
      const config = {
        platform: preset.platform,
        version: preset.version,
        colorScheme: preset.colorScheme,
        user: { id: 424242, first_name: "Test", username: "test_dev", is_premium: preset.isPremium },
        botToken: "123456789:DEVKIT_TEST_TOKEN",
        viewport: { height: preset.viewportH, isExpanded: true },
      };
      const encoded = Buffer.from(JSON.stringify(config)).toString("base64url");
      const devkitUrl = `http://localhost:${port}/demo/index.html#tma_devkit=${encoded}`;

      let browser: Browser | null = null;
      let page: Page | null = null;
      try {
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
        await page.setViewportSize({ width: preset.viewportW as number, height: preset.viewportH as number });

        // Enable headless event collection and hook events
        await page.addInitScript(() => {
          // Tell mock to post events even when not in an iframe
          (window as unknown as Record<string, unknown>).__tmaDevkitForcePost = true;
          // Hook postMessage to collect bridge events
          const collected: Array<{ id: number; ts: number; dir: string; eventType: string; data: unknown }> = [];
          (window as unknown as Record<string, unknown>).__tmaDevkitEvents__ = collected;
          window.addEventListener('message', (e: MessageEvent) => {
            try {
              const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
              if (d && d.eventType && d.source !== 'tma-devkit') {
                collected.push({ id: collected.length + 1, ts: Date.now(), dir: 'out', eventType: d.eventType, data: d.eventData || {} });
              }
            } catch { /* ignore */ }
          });
        });

        await page.goto(devkitUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(3000);

        const events: BridgeEvent[] = await page.evaluate(() => {
          return (window as unknown as { __tmaDevkitEvents__?: BridgeEvent[] }).__tmaDevkitEvents__ || [];
        });

        session.url = url;
        session.scenario = `${preset.platform} ${preset.colorScheme} Premium:${preset.isPremium}`;
        session.port = port;
        session.events = events;
        session.launchedAt = Date.now();
        session.browser = browser;
        session.page = page;
        session.liveMode = false;

        const preview = events.slice(0, 20).map(e => `${e.dir==="out"?"OUT":"IN "} ${e.eventType}`).join("\n");
        return {
          content: [{
            type: "text",
            text: `✅ Launched ${url} (${scenario}). ${events.length} events.\n\n${preview}\n\nUse devkit_action to click buttons, devkit_analyze for issues.`,
          }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await page?.close().catch(() => {});
        await browser?.close().catch(() => {});
        return { content: [{ type: "text", text: `❌ Launch failed: ${msg}` }] };
      }
    },
  );

  // devkit_action — click, fill, evaluate in the page
  server.registerTool(
    "devkit_action",
    {
      description: "Interact with the Mini App: click a button, fill a field, or run JavaScript. Requires devkit_launch first.",
      inputSchema: {
        action: z.enum(["click", "fill", "evaluate", "wait"]).describe("Action type"),
        selector: z.string().optional().describe("CSS selector for click/fill (e.g., '#main-button', 'input[name=email]')"),
        value: z.string().optional().describe("Value for fill action, or JS code for evaluate"),
        waitMs: z.number().optional().default(500).describe("Wait time after action (ms)"),
      },
    },
    async ({ action, selector, value, waitMs }) => {
      if (!session.page || session.page.isClosed()) {
        return { content: [{ type: "text", text: "❌ No active session. Run devkit_launch first." }] };
      }
      try {
        switch (action) {
          case "click":
            if (selector) await session.page.click(selector);
            break;
          case "fill":
            if (selector && value !== undefined) await session.page.fill(selector, value);
            break;
          case "evaluate":
            if (value) await session.page.evaluate(value);
            break;
          case "wait":
            await session.page.waitForTimeout(waitMs || 1000);
            break;
        }
        if (action !== "wait") await session.page.waitForTimeout(waitMs || 500);

        // Collect new events after action
        const newEvents: BridgeEvent[] = await session.page.evaluate(() => {
          return (window as unknown as { __tmaDevkitEvents__?: BridgeEvent[] }).__tmaDevkitEvents__ || [];
        });
        const diff = newEvents.slice(session.events.length);
        session.events = newEvents;

        return {
          content: [{
            type: "text",
            text: `✅ ${action}${selector ? ` on "${selector}"` : ""} — ${diff.length} new events:\n${
              diff.map(e => `${e.dir==="out"?"OUT":"IN "} ${e.eventType} ${JSON.stringify(e.data)}`).join("\n") || "(none)"
            }`,
          }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `❌ ${action} failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // devkit_screenshot — take a screenshot for the developer
  server.registerTool(
    "devkit_screenshot",
    {
      description: "Take a screenshot of the current Mini App state (for the developer, not AI analysis).",
      inputSchema: {},
    },
    async () => {
      if (!session.page || session.page.isClosed()) {
        return { content: [{ type: "text", text: "❌ No active session. Run devkit_launch first." }] };
      }
      try {
        const buf = await session.page.screenshot({ type: "png", fullPage: false });
        const base64 = buf.toString("base64");
        return {
          content: [{
            type: "image",
            data: base64,
            mimeType: "image/png",
          }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `❌ Screenshot failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // devkit_get_events — read from .jsonl or session
  server.registerTool(
    "devkit_get_events",
    {
      description: "Get bridge events from the current session or .tma-devkit/events.jsonl.",
      inputSchema: {
        filter: z.string().optional().describe("Filter by eventType"),
        limit: z.number().optional().default(50),
      },
    },
    async ({ filter, limit }) => {
      // Prefer file events (shared with live DevKit), fall back to session events
      let events = readEvents();
      if (events.length === 0) events = session.events;
      if (events.length === 0) return { content: [{ type: "text", text: "No events. Run devkit_launch first, or interact with the DevKit panel." }] };

      if (filter) {
        const f = filter.toLowerCase();
        events = events.filter((e) => e.eventType.toLowerCase().includes(f));
      }
      events = events.slice(-limit);

      const lines = events.map(
        (e) => `[${new Date(e.ts).toISOString().replace("T", " ").slice(0, 23)}] ${e.dir === "out" ? "OUT" : "IN "} ${e.eventType} ${JSON.stringify(e.data)}`,
      );
      return { content: [{ type: "text", text: `Events (${events.length}):\n${lines.join("\n")}` }] };
    },
  );

  // devkit_analyze — run 8 checks
  server.registerTool(
    "devkit_analyze",
    {
      description: "Analyze bridge events for common Mini App bugs (8 automated checks).",
      inputSchema: {},
    },
    async () => {
      let events = readEvents();
      if (events.length === 0) events = session.events;
      if (events.length === 0) return { content: [{ type: "text", text: "No events to analyze." }] };

      const warnings = analyzeEvents(events);
      const stats = new Map<string, number>();
      for (const e of events) stats.set(e.eventType, (stats.get(e.eventType) || 0) + 1);
      const statLines = Array.from(stats.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `  ${n}: ${c}`);

      const text = [
        `Analysis: ${session.url || "(live session)"} (${session.scenario || "unknown"})`,
        `Events: ${events.length}`,
        "",
        warnings.length ? `⚠️ Warnings (${warnings.length}):\n${warnings.join("\n")}` : "✅ No issues detected.",
        "",
        "Event breakdown:",
        ...statLines,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    },
  );

  // devkit_emit — send event into the app
  server.registerTool(
    "devkit_emit",
    {
      description: "Emit a client→app event into the Mini App (e.g., theme_changed, main_button_pressed).",
      inputSchema: {
        eventType: z.string().describe("Event type (e.g., theme_changed, main_button_pressed)"),
        payload: z.string().optional().describe("JSON payload"),
      },
    },
    async ({ eventType, payload }) => {
      const data = payload ? JSON.parse(payload) : {};
      if (session.page && !session.page.isClosed()) {
        await session.page.evaluate(
          ({ type, data }: { type: string; data: unknown }) => {
            const w = window as unknown as { Telegram?: { WebView?: { receiveEvent?: (t: string, d: unknown) => void } } };
            w.Telegram?.WebView?.receiveEvent?.(type, data);
          },
          { type: eventType, data },
        );
      }
      session.events.push({ id: Date.now(), ts: Date.now(), dir: "in", eventType, data });
      return { content: [{ type: "text", text: `✅ "${eventType}" emitted.` }] };
    },
  );

  // devkit_get_state
  server.registerTool(
    "devkit_get_state",
    {
      description: "Get current session state.",
      inputSchema: {},
    },
    async () => {
      if (!session.url && !session.liveMode) {
        return { content: [{ type: "text", text: "No active session. Run devkit_launch to start." }] };
      }
      const elapsed = session.launchedAt ? Date.now() - session.launchedAt : 0;
      const lines = [
        `URL: ${session.url || "(live)"}`,
        `Scenario: ${session.scenario || "unknown"}`,
        `Mode: ${session.liveMode ? "live (connected to DevKit)" : "headless (Playwright)"}`,
        `Events: ${session.events.length}`,
        `Duration: ${(elapsed / 1000).toFixed(1)}s`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // devkit_close
  server.registerTool(
    "devkit_close",
    {
      description: "Close the current session.",
      inputSchema: {},
    },
    async () => {
      await closeSession();
      return { content: [{ type: "text", text: "✅ Session closed." }] };
    },
  );

  return server;
}

// ---- Entry ----
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TMA DevKit MCP Server running");
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});