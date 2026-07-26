# TMA DevKit — MCP Server

**AI-powered Telegram Mini Apps debugging in Cursor and Claude.**

This is a [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI assistants (Cursor, Claude) directly debug your Telegram Mini Apps through the TMA DevKit emulator.

---

## What it does

Instead of you manually switching between DevKit and AI chat, **the AI itself** can:

- Launch your Mini App with any scenario (Premium iOS, Free Android, Desktop)
- Collect all bridge events (`web_app_*` calls)
- Analyze events for common bugs (missing handlers, duplicate API calls, wrong call order)
- Emit client→app events to test edge cases
- Get the current session state

All from within Cursor Chat or Claude — **no copy-paste, no browser switching.**

---

## Quickstart

### 1. Install

```bash
cd tma-devkit/mcp
npm install
npm run build
```

### 2. Configure in Cursor

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "tma-devkit": {
      "command": "node",
      "args": ["/absolute/path/to/tma-devkit/mcp/dist/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/` with the actual path to your TMA DevKit directory.

### 3. Use in Cursor Chat

Press `Cmd+L` (Mac) or `Ctrl+L` (Windows) to open AI chat, then:

> Launch http://localhost:5173 with scenario free-android and analyze it for bugs.

The AI will use `devkit_launch` → `devkit_analyze` → report issues directly in chat.

---

## Tools (what the AI can call)

| Tool | Description |
|---|---|
| `devkit_launch` | Launch a Mini App URL with scenario (premium-ios, free-android, desktop, default) |
| `devkit_get_events` | Retrieve bridge events with optional filtering and limit |
| `devkit_analyze` | Analyze events for duplicate calls, missing handlers, early-exit bugs |
| `devkit_emit` | Emit a client→app event (`main_button_pressed`, `theme_changed`, etc.) |
| `devkit_get_state` | Get current session: URL, scenario, event count, duration |

---

## Example conversation with AI

```
You: "Test my Mini App at http://localhost:5173 as a Premium iOS user"

AI: [calls devkit_launch with url="http://localhost:5173" scenario="premium-ios"]
    → Launch recorded. Use devkit_get_events to retrieve events.

You: "Now check for issues"

AI: [calls devkit_analyze]
    → Warnings found:
    ⚠️ web_app_expand called 3× — possible re-render loop
    ❌ WebApp.ready() was never called
    ⚠️ MainButton.setParams() called but main_button_pressed never received

AI: "I found 3 issues in your Mini App:
    1. expand() is called 3 times — check your useEffect at line 42 in App.tsx
    2. You never call WebApp.ready() — the loading spinner won't disappear
    3. MainButton.show() is missing after setParams — users can't see the button
    
    Want me to fix these?"
```

---

## Claude Desktop configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tma-devkit": {
      "command": "node",
      "args": ["/absolute/path/to/tma-devkit/mcp/dist/index.js"]
    }
  }
}
```

---

## Architecture

```
Cursor Chat (AI)
      │
      ▼ MCP Protocol (JSON-RPC over stdio)
┌─────────────┐
│ mcp/index.ts │  McpServer with 5 tools
│   devkit_launch
│   devkit_get_events
│   devkit_analyze
│   devkit_emit
│   devkit_get_state
└─────────────┘
      │
      ▼ In-memory session store
  { events[], scenario, url }
```

---

## License

MIT © TMA DevKit contributors.