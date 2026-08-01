/**
 * TMA DevKit — Vite Plugin
 *
 * Drop-in plugin that injects the mock script, proxies the DevKit panel,
 * and writes bridge events to .tma-devkit/events.jsonl for AI debugging.
 *
 * Usage (vite.config.ts):
 *   import devkit from 'tma-devkit/vite-plugin';
 *   export default defineConfig({ plugins: [react(), devkit()] });
 *
 * Then `npm run dev` launches your TMA with DevKit side-panel.
 */

import type { Plugin, ViteDevServer } from 'vite';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DevkitPluginOptions {
  /** Bot token for initData signing (defaults to DEVKIT_TEST_TOKEN). */
  botToken?: string;
  /** Auto-open DevKit panel in a side-panel on dev start. */
  autoOpen?: boolean;
  /** Port for the DevKit panel proxy (default: 5188). */
  panelPort?: number;
}

const MOCK_SCRIPT = resolve(__dirname, '..', '..', '..', 'public', 'tma-devkit.js');
const EVENTS_DIR = '.tma-devkit';
const EVENTS_FILE = '.tma-devkit/events.jsonl';

let mockContentCache: string | null = null;
function getMockContent(): string {
  if (mockContentCache) return mockContentCache;
  try {
    mockContentCache = readFileSync(MOCK_SCRIPT, 'utf-8');
  } catch {
    mockContentCache = '/* tma-devkit.js not found */';
  }
  return mockContentCache;
}

function ensureEventsDir(projectRoot: string) {
  const dir = resolve(projectRoot, EVENTS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Injects a script tag for tma-devkit.js in the <head> of HTML. */
function injectMockScript(html: string, devServerPort: number): string {
  const tag = `<script src="http://localhost:${devServerPort}/__tma_devkit_mock.js"></script>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `  ${tag}\n</head>`);
  }
  return `${tag}\n${html}`;
}

/** Injects the DevKit panel as a collapsible iframe sidebar. */
function injectPanelFrame(html: string, panelPort: number): string {
  const panelHtml = `
<!-- TMA DevKit Panel -->
<div id="__tma_devkit_panel" style="
  position:fixed;right:0;top:0;bottom:0;width:420px;z-index:2147483647;
  border-left:1px solid #27272a;background:#09090b;display:none;
">
  <iframe src="http://localhost:${panelPort}" style="width:100%;height:100%;border:none;"></iframe>
</div>
<button id="__tma_devkit_toggle" onclick="
  var p=document.getElementById('__tma_devkit_panel');
  p.style.display=p.style.display==='none'?'block':'none';
" style="
  position:fixed;right:0;top:50%;z-index:2147483646;
  transform:translateY(-50%) rotate(-90deg);transform-origin:right center;
  background:#3b82f6;color:#fff;border:none;border-radius:4px 4px 0 0;
  padding:4px 12px;font-size:11px;font-family:monospace;cursor:pointer;
">DevKit ▼</button>
`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${panelHtml}\n</body>`);
  }
  return `${html}\n${panelHtml}`;
}

export default function devkitPlugin(options: DevkitPluginOptions = {}): Plugin {
  const { autoOpen = true, panelPort = 5188 } = options;
  let projectRoot = process.cwd();
  let devServerPort = 5173;

  return {
    name: 'tma-devkit',
    apply: 'serve', // dev-only — never inject panel into production builds

    configResolved(config) {
      projectRoot = config.root || projectRoot;
      devServerPort = config.server?.port || 5173;
      ensureEventsDir(projectRoot);
    },

    /** Serve the mock script at /__tma_devkit_mock.js */
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__tma_devkit_mock.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(getMockContent());
      });

      // Proxy DevKit panel requests to the panel port
      server.middlewares.use('/__tma_devkit_api', (req, _res, next) => {
        // Forward API calls to the panel (e.g., config updates)
        next();
      });

      // Collect bridge events from postMessage and write to jsonl
      server.middlewares.use('/__tma_devkit_event', (req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const event = JSON.parse(body);
            const line = JSON.stringify({ ...event, ts: Date.now() }) + '\n';
            appendFileSync(resolve(projectRoot, EVENTS_FILE), line);
            res.writeHead(200);
            res.end('ok');
          } catch {
            res.writeHead(400);
            res.end('invalid json');
          }
        });
      });

      if (autoOpen) {
        const startupUrl = `http://localhost:${devServerPort}`;
        console.log(`\n  🔧 TMA DevKit panel → http://localhost:${panelPort}`);
        console.log(`  📋 Bridge events → ${EVENTS_FILE}`);
        console.log(`  🔗 Open: http://localhost:${panelPort}/?app=${encodeURIComponent(startupUrl)}`);
        console.log(`  📎 Or add #tma_devkit= to your TMA URL\n`);
      }
    },

    /** Inject mock script + panel frame into HTML */
    transformIndexHtml(html) {
      let result = injectMockScript(html, devServerPort);
      result = injectPanelFrame(result, panelPort);
      return result;
    },
  };
}