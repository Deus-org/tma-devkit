/**
 * TMA DevKit — Cross-platform file copy for npm package.
 *
 * Copies mock script, CLI, and Vite Plugin from the monorepo build
 * into the npm-package directory before publication.
 *
 * Uses Node.js fs (works identically on Windows, macOS, Linux).
 */

import { copyFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NPM_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(NPM_DIR, "..", "..");

const files = [
  {
    src: resolve(REPO_ROOT, "public", "tma-devkit.js"),
    dest: resolve(NPM_DIR, "tma-devkit.js"),
    label: "mock script",
  },
  {
    src: resolve(REPO_ROOT, "dist-tma-devkit", "cli.js"),
    dest: resolve(NPM_DIR, "cli.js"),
    label: "CLI",
  },
  {
    src: resolve(REPO_ROOT, "dist-tma-devkit", "vite-plugin", "index.js"),
    dest: resolve(NPM_DIR, "vite-plugin.js"),
    label: "Vite plugin (JS)",
  },
  {
    src: resolve(REPO_ROOT, "dist-tma-devkit", "vite-plugin", "index.d.ts"),
    dest: resolve(NPM_DIR, "vite-plugin.d.ts"),
    label: "Vite plugin (types)",
  },
];

let ok = 0;
let fail = 0;

for (const { src, dest, label } of files) {
  try {
    if (!existsSync(src)) {
      console.error(`❌ Source not found (run build:all first): ${src}`);
      fail++;
      continue;
    }
    copyFileSync(src, dest);
    ok++;
  } catch (err) {
    console.error(`❌ Failed to copy ${label}:`, err instanceof Error ? err.message : err);
    fail++;
  }
}

console.log(`\n  Copied ${ok} file${ok === 1 ? "" : "s"}${fail ? `, ${fail} failed` : ""}`);
if (fail) process.exit(1);