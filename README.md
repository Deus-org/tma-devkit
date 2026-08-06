# TMA DevKit

Local emulator and bridge inspector for Telegram Mini Apps.

`npm install tma-devkit` — run your Mini App locally with a mock of `window.Telegram.WebApp`, cryptographically valid `initData`, and AI-assisted debugging via MCP.

MIT licensed · no affiliation with Telegram

---

## Installation

```bash
npm install tma-devkit
```

## Integration

### Vite Plugin (React/Vite)

```ts
// vite.config.ts
import devkit from 'tma-devkit/vite-plugin';

export default defineConfig({
  plugins: [react(), devkit()],
});
```

DevKit panel opens as a right sidebar in your dev server. Bridge events are written to `.tma-devkit/events.jsonl`.

### CLI (any framework)

```bash
npx tma-devkit dev --app http://localhost:5173
```

Launches the panel on `:5188` and pre-loads your app. No code changes required.

### Script tag (static sites, CDN)

```html
<script src="http://localhost:5188/tma-devkit.js"></script>
```

Inert unless `#tma_devkit=…` config is present in the URL.

---

## Features

### Emulator

- Mocks `window.Telegram.WebApp` API (MainButton, popups, CloudStorage, haptics, etc.)
- Cryptographically valid `initData` — `hash` computed with HMAC-SHA-256 per Telegram spec
- `@telegram-apps/sdk` v3 compatible — launch params in URL-hash format + `sessionStorage` fallback
- Framework-agnostic — works with React, Next.js, Nuxt, SvelteKit, vanilla JS

### Panel

- 5 quick scenarios (Premium iOS, Free Android, New user, Group chat, Desktop)
- 9 platforms, Bot API 6.0–8.0+
- 15 `themeParams` with live push
- Viewport presets + zoom 25%–200%
- User profile emulation (ID, username, premium status, photo)
- `start_param` injection for deep links
- CloudStorage visual editor
- Import/Export JSON configs

### Bridge Event Inspector

- Live event log with timestamps and direction (app→client / client→app)
- Grouped/flat view, filtering, pause, auto-scroll
- Export as `.txt`
- Emit console — fire 12+ client→app events manually

### AI Debugging (MCP)

8 MCP tools for AI-assisted debugging. Two modes:

- **Manual** — you interact in browser → events write to `.tma-devkit/events.jsonl` → AI reads via `devkit_get_events` + `devkit_analyze`
- **Automated** — AI calls `devkit_launch` + `devkit_action` (click/fill/evaluate) in headless Playwright → collects events → analyzes

Supported clients: Cursor, Claude Code, Cline (VS Code), Claude Desktop.

---

## How it works

1. Panel encodes config as base64url JSON → `#tma_devkit=…` on the iframe URL
2. Mock parses it, replaces fragment with real Telegram launch params, builds `window.Telegram.WebApp`
3. Client→app events delivered via `postMessage`
4. Everything recorded in inspector + `.tma-devkit/events.jsonl`

## initData signing

```
data_check_string = all fields except `hash`, sorted, joined as `key=<value>` with '\n'
secret_key        = HMAC_SHA256(key = "WebAppData", data = bot_token)
hash              = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
```

Computed synchronously before `DOMContentLoaded`. Verify against `node:crypto`:

```bash
npm run verify:hmac
```

---

## Testing

```bash
npm test           # Vitest — 42 tests
npm run test:watch # Watch mode
```

---

## Limitations

- Popups / QR scanner — emulated with in-app modals
- Haptics, openLink, switchInlineQuery, invoices — recorded in inspector, no real side-effects
- Sensor APIs — stubs that report unavailability
- Signature (Bot API 8.0 Ed25519) — deterministic placeholder; validate `hash` instead

---

## FAQ

**Does it work with Next.js / Nuxt / SvelteKit?**

Yes. Use the CLI or script tag. The mock is framework-agnostic and runs in any browser environment.

```tsx
// Next.js example (app/layout.tsx)
import Script from 'next/script';

<Script
  src="http://localhost:5188/tma-devkit.js"
  strategy="beforeInteractive"
/>
```

**Is initData cryptographically valid?**

Yes. The `hash` is computed with real HMAC-SHA-256 using the bot token as the key. Your backend validation will accept it.

**Does it work with `@telegram-apps/sdk` v3?**

Yes. Launch params are injected in the exact URL-hash format the SDK expects, with `sessionStorage` fallback.

**Can I use this in production?**

No. This is a development tool. The mock should not be included in production builds.

**How is this different from Telegram's test environment?**

Telegram's test environment requires deploying to a real bot. DevKit runs entirely locally, supports offline development, and provides an event inspector and AI debugging tools.

**Does it support Bot API 8.0?**

Yes. The panel supports Bot API 6.0 through 8.0+.

**Can AI tools like Cursor/Cline debug my app with this?**

Yes. DevKit includes an MCP server with 8 tools. AI can launch your app, click through it, and analyze bridge events automatically.

---

## License

MIT © TMA DevKit contributors. Not affiliated with Telegram.