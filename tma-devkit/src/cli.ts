#!/usr/bin/env node
/**
 * TMA DevKit — CLI
 *
 * One-command setup for any TMA project:
 *
 *   npx tma-devkit dev [--port 5188] [--app http://localhost:5173]
 *
 * This launches the DevKit panel on the given port and opens the browser.
 * If --app is provided, the panel pre-loads that URL in the iframe.
 */

import { resolve, dirname } from 'path';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { createServer, type ServerResponse } from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0] || 'dev';

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const PORT = parseInt(getArg('--port', '5188'), 10);
const APP_URL = getArg('--app', '');

// In npm package: cli.js sits at <pkg>/cli.js, panel at <pkg>/dist/
// In dev repo:    cli.js sits at <repo>/dist-tma-devkit/cli.js, panel at <repo>/dist/
const DIST_DIR = existsSync(resolve(__dirname, 'dist'))
  ? resolve(__dirname, 'dist')
  : resolve(__dirname, '..', 'dist');

function serveStatic(res: ServerResponse, filePath: string, contentType: string) {
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function startDevKit() {
  // MIME types for common static files
  const MIME: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.woff2': 'font/woff2',
  };

  const server = createServer((req, res) => {
    const url = (req.url || '/').split('?')[0].split('#')[0]; // strip query/hash

    // Events endpoint: write bridge events to .tma-devkit/events.jsonl
    if (req.method === 'POST' && url === '/__tma_devkit_event') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          JSON.parse(body);
          const cwd = process.cwd();
          const dir = resolve(cwd, '.tma-devkit');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          appendFileSync(resolve(cwd, '.tma-devkit', 'events.jsonl'), body + '\n');
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
          res.end('ok');
        } catch {
          res.writeHead(400);
          res.end('invalid json');
        }
      });
      return;
    }

    // Determine file path and content type
    let filePath: string;
    let contentType: string;

    if (url === '/' || url === '') {
      filePath = 'index.html';
      contentType = 'text/html';
    } else {
      filePath = url.replace(/^\//, '');
      const extMatch = filePath.match(/\.([a-z0-9]+)$/i);
      const ext = extMatch ? '.' + extMatch[1].toLowerCase() : '';
      contentType = MIME[ext] || 'text/html'; // default to HTML for SPA routes
    }

    const indexPath = resolve(DIST_DIR, 'index.html');
    serveStatic(res, filePath === 'index.html' ? indexPath : resolve(DIST_DIR, filePath), contentType);
  });

  server.listen(PORT, () => {
    const appParam = APP_URL ? `#tma_devkit=${encodeURIComponent(APP_URL)}` : '';
    const devkitUrl = `http://localhost:${PORT}/${appParam}`;

    console.log(`
╔══════════════════════════════════════════╗
║        🔧 TMA DevKit                    ║
║   Telegram Mini Apps Emulator           ║
╠══════════════════════════════════════════╣
║  Panel:  http://localhost:${PORT}           ${' '.repeat(Math.max(0, 5 - PORT.toString().length))}║
║  Events: .tma-devkit/events.jsonl     ║
╚══════════════════════════════════════════╝
`);

    // Try to open browser
    const platform = process.platform;
    let openCmd: string;
    if (platform === 'win32') openCmd = 'start';
    else if (platform === 'darwin') openCmd = 'open';
    else openCmd = 'xdg-open';

    spawn(openCmd, [devkitUrl], { shell: true, stdio: 'ignore' }).unref();

    console.log(`  Opening ${devkitUrl} ...\n`);
  });
}

if (command === 'dev') {
  if (!existsSync(DIST_DIR)) {
    console.error('❌ dist/ not found. Run "npm run build" in tma-devkit first.');
    process.exit(1);
  }
  startDevKit();
} else {
  console.log(`
TMA DevKit — CLI

Usage:
  npx tma-devkit dev [options]

Options:
  --port <port>   Panel port (default: 5188)
  --app <url>     Pre-load Mini App URL in the iframe

Examples:
  npx tma-devkit dev
  npx tma-devkit dev --app http://localhost:5173
  `);
}