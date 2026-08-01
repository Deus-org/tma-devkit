import path from "path"
import react from "@vitejs/plugin-react"
import { appendFileSync, existsSync, mkdirSync } from "fs"
import { resolve } from "path"
import { defineConfig } from "vite"

const EVENTS_DIR = ".tma-devkit";
const EVENTS_FILE = ".tma-devkit/events.jsonl";

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'tma-devkit-events',
      configureServer(server) {
        // Ensure events directory exists
        const projectRoot = process.cwd();
        const dir = resolve(projectRoot, EVENTS_DIR);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        // Accept bridge events from the panel and write to jsonl
        server.middlewares.use('/__tma_devkit_event', (req, res) => {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              JSON.parse(body); // validate
              appendFileSync(resolve(projectRoot, EVENTS_FILE), body + '\n');
              res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
              res.end('ok');
            } catch {
              res.writeHead(400);
              res.end('invalid json');
            }
          });
        });
      },
    }
  ],
  server: {
    port: 5188,
    strictPort: true,
    fs: {
      strict: false,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});