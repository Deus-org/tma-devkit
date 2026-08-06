/**
 * TMA DevKit — Cross-platform file copy for npm package.
 *
 * Copies mock script, CLI, Vite Plugin, and the built panel (dist/)
 * from the monorepo build into the npm-package directory before publication.
 *
 * Uses Node.js fs (works identically on Windows, macOS, Linux).
 */

import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "fs";
import { resolve, dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NPM_DIR = resolve(__dirname, ".."); // .../tma-devkit/tma-devkit/npm-package
const REPO_ROOT = resolve(NPM_DIR, "..", ".."); // .../tma-devkit (repo root)

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

/** Recursively copy a directory preserving structure into destRoot. */
function copyDir(srcDir, destRoot) {
  if (!existsSync(srcDir)) {
    console.error(`❌ Source dir not found: ${srcDir}`);
    fail++;
    return;
  }
  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const rel = relative(REPO_ROOT, src);
    const dest = join(NPM_DIR, rel);
    if (statSync(src).isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyDir(src, destRoot);
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      try {
        copyFileSync(src, dest);
        ok++;
      } catch (err) {
        console.error(`❌ Failed to copy ${rel}:`, err instanceof Error ? err.message : err);
        fail++;
      }
    }
  }
}

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

// Copy the built panel (dist/) into the package so `npx tma-devkit dev` works standalone.
const distSrc = resolve(REPO_ROOT, "dist");
if (existsSync(distSrc)) {
  copyDir(distSrc, NPM_DIR);
  // copyDir above places files under <NPM_DIR>/dist; report as separate step
}

console.log(`\n  Copied ${ok} file${ok === 1 ? "" : "s"}${fail ? `, ${fail} failed` : ""}`);

// Verify panel assets landed
const panelOk = existsSync(resolve(NPM_DIR, "dist", "index.html"));
if (!panelOk) {
  console.error("❌ Panel dist/index.html was not copied.");
  fail++;
}

if (fail) process.exit(1);