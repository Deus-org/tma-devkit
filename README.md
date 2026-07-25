# TMA DevKit

**Local emulator & bridge inspector for Telegram Mini Apps.**

Think *Redux DevTools* meets *WeChat Mini Program DevTools*, but for `window.Telegram.WebApp`.

> MIT licensed · no affiliation with Telegram · built by the community, for the community

---

## The problem

There is **no official Telegram Mini Apps emulator**. The standard dev loop is painful:

1. Run your app locally.
2. Expose it via ngrok/localtunnel.
3. Create a bot through @BotFather. Set the Menu Button / web_app URL.
4. Open Telegram on your phone. Launch the app. `console.log` blindly.
5. Repeat for **every theme, platform, user combination** you want to test.

**Sound familiar?** Here's what actual TMA developers say:

> «Главные сложности — невозможность запустить проект так же просто, как в браузере через localhost, а также **отсутствие консоли разработчика**»
> — Habr, март 2025

> «Проблема TMA в **отсутствии адекватной тестовой среды**»
> — workspace.ru, июнь 2025

> «Running Telegram Mini app on localhost» — вопрос на StackOverflow, ответы: костыли с HTTPS, ngrok, localtunnel.

**TMA DevKit replaces all of that** with a single local page. Paste your mini-app URL, and it runs in an iframe against a faithful mock of the Telegram client — with signed `initData`, theme/platform/user presets, visual device chrome, and a full bridge-event inspector.

---

## Who is this for?

- **Freelance TMA developers** — debug your Mini App without switching to your phone every 30 seconds.
- **TMA studios & agencies** — onboard new devs in minutes, not hours. Reproduce client bugs instantly with saved presets.
- **SDK maintainers** — test against every platform/version/theme combination without a fleet of devices.
- **Backend developers** — your `initData` validation code actually passes because the hash is cryptographically correct.
- **Anyone building on `@telegram-apps/sdk`** — DevKit speaks the exact bridge protocol your SDK expects.

---

## Features

### 🔧 Core emulator

| Feature | Description |
|---|---|
| **Zero-setup local mock** | Drop `tma-devkit.js` into your app or point the panel at your dev-server URL. The mock replicates the full `window.Telegram.WebApp` API surface. |
| **Cryptographically valid initData** | The `hash` field is computed with real HMAC-SHA-256 per the [official spec](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). Your backend validation passes against the dev bot token. |
| **`@telegram-apps/sdk` v3 compatible** | Launch params are injected in the exact URL-hash format the SDK's `retrieveLaunchParams()` expects — plus the `tapps/launchParams` sessionStorage fallback. |
| **SDK-agnostic bridge** | The mock uses the same `postMessage` wire format as the official script. Works with any SDK that speaks `web_app_*` events. |

### 🎛️ Developer panel

| Feature | Description |
|---|---|
| **Quick Scenarios** | 5 one-click presets: Premium iOS user, Free Android user, New user with referral, Group chat launch, Desktop wide viewport. Switch contexts instantly. |
| **Saved Presets** | Save any configuration as a named preset. Switch between them in one click. Persists across sessions via localStorage. Perfect for reproducing bugs. |
| **Platform & version switching** | iOS, Android, tDesktop, macOS, Web K, Web A — all 9 official platforms. Version from Bot API 6.0 to 8.0+. |
| **Theme editor** | Toggle light/dark. Edit all 15 `themeParams` with live color previews. Push changes without reloading the app. |
| **Viewport presets** | iPhone 14 (390×844), Android (360×800), Desktop (1200×800), Compact (390×500). Custom width/height. Zoom from 25% to 200%. |
| **User profile customization** | ID, username, name, language, photo URL, `is_premium` flag. Every field flows into `initData`. |
| **`start_param` injection** | Emulate deep link launches with referral codes, invite links, or custom parameters. |
| **Visual device chrome** | Mobile view shows a notch with platform label. Desktop view shows macOS-style traffic lights. Reacts to platform changes. |

### 📊 Bridge event inspector

| Feature | Description |
|---|---|
| **Live event log** | Every `web_app_*` call appears in real time with timestamps and direction indicators (app→client / client→app). |
| **Grouped view** | Collapse events by type. See `web_app_ready` ×12, `viewport_changed` ×4 in clean, scannable groups. Toggle to flat list anytime. |
| **Filtering** | Search by event type or payload content. Instant filtering as you type. |
| **Pause / Resume** | Freeze the log to inspect a moment without new events pushing it away. |
| **Auto-scroll** | Toggle on/off. Stays at the bottom by default; turn off to scroll back through history. |
| **Export logs** | Download the full event log as a `.txt` file for bug reports or sharing with your team. |
| **Emit console** | Fire client→app events into your Mini App: `theme_changed`, `viewport_changed`, `main_button_pressed`, invoice/popup/QR results, and 12 more event types. Fully customizable JSON payload. |

### ☁️ CloudStorage inspector

| Feature | Description |
|---|---|
| **Visual key editor** | Add, view, and delete CloudStorage keys through a modal UI — no code needed. |
| **Mock integration** | Keys are stored in localStorage and served to your Mini App's `CloudStorage.getItem` calls. Test storage-dependent flows without a real Telegram client. |

### 📦 Import / Export

| Feature | Description |
|---|---|
| **Export JSON** | Download your entire configuration (URL, platform, user, theme, viewport, bot token) as a portable JSON file. |
| **Import JSON** | Load a saved configuration in one click. Share configs with teammates for bug reproduction. |
| **Copy launch URL** | Get a shareable URL with the full config encoded — send it to a colleague, and they see exactly what you see. |
| **Copy snippet** | One-click copy of the `<script>` tag to embed the mock in your own app. |

### 🖥️ Panel UX

| Feature | Description |
|---|---|
| **Drag-to-resize panels** | Resize the config panel and inspector by dragging the dividers. Works like VS Code. |
| **Toggle panels** | Hide the left or right panel for a full-width device stage. Toggle back with one click. |
| **Zoom controls** | Zoom the device stage in/out (25%–200%) with +/- buttons. Auto-fit to container. Reset to 100%. |
| **Connection status** | Green pulsing dot when the mock is connected. Gray when waiting. |
| **Live push** | Push theme and viewport changes to the running app without reloading. Tweak `themeParams` and see the result instantly. |

---

### How it compares

| | ngrok + phone + Eruda | tmakit (jw-mans) | **TMA DevKit** |
|---|---|---|---|
| Real Telegram client required | ✅ Yes | ❌ No | ❌ No |
| Visual device chrome | ❌ | ❌ | ✅ Mobile notch + desktop window |
| Cryptographically valid initData | ✅ (real) | ❓ Claimed (server-side only) | ✅ Client-side HMAC-SHA-256 |
| `@telegram-apps/sdk` v3 support | ✅ (native) | ❓ Claimed | ✅ Exact launch-params format |
| Quick scenarios / presets | ❌ | ❌ | **✅ 5 built-in + save your own** |
| Grouped event inspector | ❌ (Eruda is flat) | ❓ Claimed (no screenshot) | ✅ Collapsible groups with counts |
| CloudStorage editor | ❌ | ❌ | ✅ Visual key editor |
| Export / Import config | ❌ | ❌ | ✅ JSON file + launch URL |
| Logs export | ❌ | ❌ | ✅ Download as .txt |
| Drag-resize panels | ❌ | ❌ | ✅ Like VS Code |
| Zoom controls | ❌ | ❌ | ✅ 25%–200% + auto-fit |
| Totally free | ✅ | ❓ (MIT, unknown future) | ✅ MIT — forever free |

---

## Quickstart

```bash
npm install
npm run dev        # http://localhost:5188
```

Then either:

- **Use the bundled demo** — the panel loads `/demo/` by default. Click around; watch the inspector fill with `web_app_ready`, `web_app_expand`, `web_app_setup_main_button`, etc.
- **Point it at your app** — enter your dev-server URL (e.g. `http://localhost:5173/`), press **Apply & reload**. Your app loads with a mocked `window.Telegram.WebApp`.
- **Or add the snippet** to your app's `index.html` (first in `<head>`):

  ```html
  <script src="http://localhost:5188/tma-devkit.js"></script>
  ```

  The script is **inert unless a devkit config is present** — via the `#tma_devkit=…` URL fragment the panel appends, or a `setConfig` postMessage — so it is safe to keep around during development and strip for production.

---

## How it works

```
┌──────────────────────────── TMA DevKit panel (React) ───────────────────────────┐
│  config sidebar        device stage                event inspector              │
│  ─────────────        ┌──────────────────┐        ────────────────              │
│  Quick scenarios,     │ iframe           │        web_app_ready ▲              │
│  saved presets,       │  ┌────────────┐  │        web_app_expand   {payload}   │
│  platform/theme,      │  │ your app   │  │──► #tma_devkit=…       {type:"…"}   │
│  user/botToken ──────►│  │ + mock env │  │                     │              │
│  viewport             │  │  (WebApp)  │──┼── postMessage ──────┘               │
│                       │  └────────────┘  │                                     │
│  emit console ────────┼─►               ◄─┼── theme_changed …                  │
│                       └──────────────────┘                                     │
└────────────────────────────────────────────────────────────────────────────────┘
```

1. The panel encodes your config as base64url JSON into `#tma_devkit=…` on the iframe URL.
2. The mock (`tma-devkit.js`) parses it, **replaces the fragment with real Telegram launch params** (`#tgWebAppPlatform=…&tgWebAppData=…&…`), builds `window.Telegram.WebApp`, and starts relaying every bridge call as `postMessage`.
3. Client→app events (`theme_changed`, `viewport_changed`, `main_button_pressed`, etc.) are delivered back through the same channel and dispatched to `WebApp.onEvent` handlers.
4. Everything is recorded in the inspector — timestamped, filterable, groupable, and exportable.

### initData signing

`tgWebAppData` is a query string built from your configured user/chat/start_param, signed with your dev bot token per the [official docs](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):

```
data_check_string = all fields except `hash`, sorted alphabetically,
                    joined as `key=<value>` with '\n'
secret_key        = HMAC_SHA256(key = "WebAppData", data = bot_token)
hash              = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
```

The mock computes this **synchronously** with an embedded HMAC-SHA-256, so `WebApp.initData` is complete before `DOMContentLoaded` — no async race with your app code. `window.__tmaDevkitReady` resolves once the environment is fully applied.

Verify the crypto against `node:crypto` any time:

```bash
npm run verify:hmac
```

---

## Repo layout

```
public/tma-devkit.js     the mock environment (dependency-free, framework-agnostic)
public/demo/index.html   bundled demo mini app (vanilla JS, no build step)
public/demo/sdk.html     @telegram-apps/sdk v3 integration demo (esm.sh CDN)
src/                     the panel (React + TS + Tailwind + shadcn/ui)
  lib/devkit.ts          config model, codec, bridge catalogs, presets
  lib/devkit.test.ts     22 unit tests (base64url, config, bridge protocol)
  hooks/useDevkit.tsx    state + postMessage bus + presets persistence
  sections/
    ConfigPanel.tsx       Quick scenarios, saved presets, CloudStorage, import/export
    DeviceStage.tsx       Zoomable device stage with platform chrome
    EventInspector.tsx    Grouped/flat event log with export and emit console
  pages/Home.tsx         3-zone layout with drag-to-resize panels
vitest.config.ts         test runner configuration
scripts/verify-hmac.mjs  HMAC correctness test vs node:crypto
```

---

## Testing

```bash
npm test           # Vitest — 22 tests in devkit.test.ts
npm run test:watch # Watch mode
```

Tests cover the entire protocol layer:
- `base64UrlEncode` / `base64UrlDecode` — round-trip, padding, URL-safe characters, unicode
- `defaultConfig` — valid defaults, theme integrity
- `toWireConfig` — panel-only field stripping, `startParam` logic
- `buildIframeUrl` — hash fragment injection, URL cleaning
- `isDevkitControlMessage` / `isBridgeEvent` — protocol discrimination (5 + 4 cases)

---

## Notes & limitations

- **Popups / QR scanner** are emulated with in-app modals.
- **Haptics, `openLink`, `switchInlineQuery`, invoices** are recorded in the inspector but have no real client side-effects (there's no Telegram client — that's the point).
- **Sensor APIs** (accelerometer/gyroscope/biometry/location) are stubs that post the official bridge events and immediately report unavailability.
- Only the `postMessage` (iframe) bridge is emulated; `TelegramWebviewProxy` and `window.external.notify` (native clients) are out of scope.
- The Bot API 8.0 `signature` field (Ed25519) cannot be reproduced locally — a deterministic placeholder is emitted. Validate `hash`, not `signature`, in development.

---

## Roadmap

- [ ] Server-side initData validation snippet (Node/Python) in the docs
- [ ] `tma-devkit` npm package (mock script as an import)
- [ ] Chrome extension (inject mock into any page, no script tag)
- [ ] CI / headless mode (Playwright integration)
- [ ] Deeper SDK v3 integration tests
- [ ] InitData presets for group chat / attachment-menu launches

---

## License

MIT © TMA DevKit contributors. See [LICENSE](./LICENSE).

TMA DevKit is a community development tool and is **not affiliated with, endorsed by, or sponsored by Telegram**.