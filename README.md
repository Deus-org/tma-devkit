# TMA DevKit

**Local emulator & bridge inspector for Telegram Mini Apps.**

`npm install tma-devkit` — and your Mini App runs locally with a faithful mock of `window.Telegram.WebApp`, cryptographically valid `initData`, and AI-powered debugging via MCP.

> MIT licensed · no affiliation with Telegram

---

## Who is this for?

- **TMA developers** — debug locally instead of deploying to Telegram every 30 seconds
- **SDK maintainers** — test against every platform/version/theme combination without a fleet of devices
- **Backend developers** — your `initData` validation code actually passes because the hash is cryptographically correct
- **AI-assisted developers** — Cline, Cursor, and Claude can launch, interact, and analyze your Mini App automatically

---

## Quickstart

```bash
npm install tma-devkit
npm run dev        # http://localhost:5188
```

Then pick your integration:

#### 1. Vite Plugin (recommended for React/Vite)

```ts
// vite.config.ts
import devkit from 'tma-devkit/vite-plugin';

export default defineConfig({
  plugins: [react(), devkit()],
});
```

Now `npm run dev` launches your TMA **with DevKit panel as a right sidebar**. Bridge events write to `.tma-devkit/events.jsonl` for AI debugging.

#### 2. npx CLI (zero-install)

```bash
npx tma-devkit dev --app http://localhost:5173
```

Launches the DevKit panel on `:5188` and pre-loads your app. No code changes needed.

#### 3. Script tag (static sites / CDN)

```html
<script src="http://localhost:5188/tma-devkit.js"></script>
```

The script is inert unless a `#tma_devkit=…` config is present.

#### 4. Use the bundled demo

The panel loads `/demo/index.html` by default. Click around; watch the inspector fill with events.

---

## Features

### Core emulator

- **Zero-setup local mock** — replicates the full `window.Telegram.WebApp` API surface
- **Cryptographically valid initData** — `hash` computed with real HMAC-SHA-256
- **`@telegram-apps/sdk` v3 compatible** — launch params in exact URL-hash format + `sessionStorage` fallback
- **SDK-agnostic bridge** — uses the same `postMessage` wire format as the official script

### Developer panel

- **5 Quick Scenarios** — Premium iOS, Free Android, New user, Group chat, Desktop
- **Saved Presets** — save/load configs with localStorage persistence
- **Platform & version switching** — 9 platforms, Bot API 6.0–8.0+
- **Theme editor** — 15 `themeParams` with live color previews, push without reload
- **Viewport presets** — iPhone 14, Android, Desktop, Compact + custom + zoom 25%–200%
- **User profile** — ID, username, name, language, `is_premium`, photo URL
- **start_param injection** — emulate deep links and referrals
- **Visual device chrome** — mobile notch + platform label, desktop traffic lights

### Bridge event inspector

- **Live event log** — real-time with timestamps and direction (app→client / client→app)
- **Grouped/flat view** — collapse by event type
- **Filtering, Pause, Auto-scroll**
- **Export logs** — download as `.txt`
- **Emit console** — fire 12+ client→app events

### AI Debugging (MCP)

DevKit includes 8 MCP tools for AI-assisted debugging. Two modes:

| Mode | How it works |
|---|---|
| **Manual** | You interact with your TMA in the browser → events write to `.tma-devkit/events.jsonl` → AI reads them via `devkit_get_events` + `devkit_analyze` |
| **Automated** | You describe a scenario → AI calls `devkit_launch` + `devkit_action` (click/fill/evaluate) in headless Playwright → collects events → analyzes |

**How to set up MCP for your AI client:**

| AI Client | Setup |
|---|---|
| **Cursor** | Open the project → `.mcp.json` auto-detected. Ready. |
| **Claude Code** (CLI) | Open the project → `.mcp.json` auto-detected. Ready. |
| **Cline** (VS Code) | MCP Marketplace → search `tma-devkit` → Install. Or manually: `npx tma-devkit-mcp`. |
| **Claude Desktop** | Add `npx tma-devkit-mcp` to `claude_desktop_config.json`. |

**Example: manual debugging**

```
You: "Why did my app crash after the payment button?"

AI reads .tma-devkit/events.jsonl → finds:
  - web_app_open_invoice (slug=donate_10)
  - web_app_close (return_back=false)  ← app closed immediately!

AI: "Your app closed right after opening the invoice.
     The close() was called at Payments.tsx line 42 — 
     unhandled promise rejection in handlePayment()."
```

**Example: automated testing**

```
You: "Test the registration flow as Free Android"

AI → devkit_launch("http://localhost:5173", "free-android")
AI → devkit_action("click", "#register-btn")
AI → devkit_action("fill", "input[name=name]", "Ivan")
AI → devkit_action("click", "#submit")
AI → devkit_get_events → devkit_analyze

AI: "Registration flow: 12 events. ⚠️ sendData with empty payload.
     Check handleRegister() at Registration.tsx:87."

### Other features

- **CloudStorage inspector** — visual key editor, mock integration
- **Import/Export** — JSON config, copy launch URL, copy snippet
- **Drag-to-resize panels** — like VS Code
- **Live push** — theme/viewport changes without reload

---

## How it works

```
┌─────────────────────────── TMA DevKit panel (React) ──────────────────────────┐
│  config sidebar        device stage                event inspector            │
│  ─────────────        ┌──────────────────┐        ────────────────            │
│  Quick scenarios,     │ iframe           │        web_app_ready ▲             │
│  platform/theme,      │  ┌────────────┐  │        web_app_expand  {payload}   │
│  user/botToken ──────►│  │ your app   │  │──► #tma_devkit=…                   │
│  viewport             │  │ + mock env │  │                     │              │
│                       │  │  (WebApp)  │──┼── postMessage ──────┘              │
│                       │  └────────────┘  │                                    │
│  emit console ────────┼─►              ◄─┼── theme_changed …                  │
│                       └──────────────────┘                                    │
└───────────────────────────────────────────────────────────────────────────────┘
```

1. Panel encodes config as base64url JSON → `#tma_devkit=…` on the iframe URL
2. Mock parses it, replaces fragment with real Telegram launch params, builds `window.Telegram.WebApp`
3. Client→app events delivered back through `postMessage`
4. Everything recorded in the inspector + `.tma-devkit/events.jsonl` for AI

### initData signing

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
npm test           # Vitest — 42 tests (22 devkit + 20 analyzer)
npm run test:watch # Watch mode
```

---

## Notes & limitations

- **Popups / QR scanner** — emulated with in-app modals
- **Haptics, openLink, switchInlineQuery, invoices** — recorded in inspector, no real side-effects
- **Sensor APIs** — stubs that report unavailability
- **Signature** (Bot API 8.0 Ed25519) — deterministic placeholder; validate `hash` instead

---

## Repo layout

```
public/tma-devkit.js     mock environment (dependency-free, framework-agnostic)
public/demo/             demo mini app + @telegram-apps/sdk v3 demo
src/                     panel (React + TS + Tailwind + shadcn/ui)
tma-devkit/src/          Vite Plugin + CLI source
mcp/                     MCP server (8 tools, Playwright headless)
scripts/                 HMAC verification
```

---

## License

MIT © TMA DevKit contributors. Not affiliated with Telegram.
