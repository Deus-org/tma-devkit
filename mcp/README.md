# TMA DevKit — MCP Server

**AI-powered Telegram Mini Apps debugging in Cline, Cursor, and Claude.**

This is a [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI assistants directly debug your Telegram Mini Apps through the TMA DevKit emulator.

---

## Quickstart

```bash
cd tma-devkit/mcp
npm install
npm run build
```

## Tools (8 total)

| Tool | Description |
|---|---|
| `devkit_launch` | Launch a Mini App URL with Playwright automation. Headless browser opens your app with DevKit mock. |
| `devkit_action` | Interact with the Mini App: click buttons, fill fields, run JavaScript, wait. |
| `devkit_get_events` | Retrieve bridge events from the session or `.tma-devkit/events.jsonl`. |
| `devkit_analyze` | Analyze events for 8 common Mini App bugs (duplicate calls, missing handlers, early-exit). |
| `devkit_emit` | Emit a client→app event into the Mini App (e.g., `theme_changed`, `main_button_pressed`). |
| `devkit_screenshot` | Take a screenshot of the current Mini App state (for the developer, not AI analysis). |
| `devkit_get_state` | Get current session info: URL, scenario, event count, duration. |
| `devkit_close` | Close the current browser session. |

## Example conversation with AI

```
You: "Test my Mini App at http://localhost:5173 as Premium iOS user"

AI: [calls devkit_launch with url="http://localhost:5173" scenario="premium-ios"]
    → Launched. 12 events collected.

You: "Click the register button and check for issues"

AI: [calls devkit_action("click", "#register-btn")]
    → 3 new events: web_app_ready, web_app_expand, web_app_data_send
    
AI: [calls devkit_analyze]
    → ⚠️ web_app_data_send with near-empty payload
    → ⚠️ web_app_close called <2s after launch
    
AI: "Two issues found:
    1. sendData called with empty payload — check handleRegister() at line 42
    2. App closed immediately — possible unhandled exception in onSubmit()"
```

## Architecture

```
Cursor / Cline / Claude (AI)
      │
      ▼ MCP Protocol (JSON-RPC over stdio)
┌─────────────┐
│ mcp/index.ts │  8 tools
└─────────────┘
      │
      ▼ Playwright (headless Chromium)
┌──────────────┐
│  Mini App    │  + DevKit mock (tma-devkit.js)
│  in iframe   │  + Bridge event collector
└──────────────┘
```

## License

MIT © TMA DevKit contributors.