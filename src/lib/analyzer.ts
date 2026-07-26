/**
 * TMA DevKit — AI Report analyzer.
 * Scans bridge event logs for common Mini App issues and generates
 * a structured Markdown report suitable for pasting into any AI chat.
 */
import type { BridgeLogEntry } from './devkit';

export interface AnalyzerWarning {
  severity: 'high' | 'medium' | 'low';
  message: string;
  detail?: string;
}

export interface EventStats {
  name: string;
  count: number;
}

export interface AnalyzerReport {
  appUrl: string;
  scenario: string;
  durationMs: number;
  totalEvents: number;
  warnings: AnalyzerWarning[];
  stats: EventStats[];
  rawEvents: BridgeLogEntry[];
}

function timeGroup(events: BridgeLogEntry[], maxGapMs: number): BridgeLogEntry[][] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const groups: BridgeLogEntry[][] = [];
  let current: BridgeLogEntry[] = [];
  for (const e of sorted) {
    if (current.length === 0 || e.ts - current[current.length - 1].ts <= maxGapMs) {
      current.push(e);
    } else {
      if (current.length > 0) groups.push(current);
      current = [e];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function analyzeLogs(logs: BridgeLogEntry[], appUrl: string, scenario: string): AnalyzerReport {
  const warnings: AnalyzerWarning[] = [];
  const outEvts = logs.filter((l) => l.dir === 'out');
  const inEvts = logs.filter((l) => l.dir === 'in');

  // ---- 1. Duplicate expand() calls (re-render loop) ----
  const expandEvents = outEvts.filter((l) => l.eventType === 'web_app_expand');
  if (expandEvents.length > 1) {
    const groups = timeGroup(expandEvents, 500);
    for (const g of groups) {
      if (g.length > 1) {
        warnings.push({
          severity: 'high',
          message: `web_app_expand called ${g.length}× within ${g[g.length - 1].ts - g[0].ts}ms`,
          detail: 'Possible re-render loop. Check if expand() is inside useEffect without deps, or called unconditionally in a component body. Move it to a single on-mount effect.',
        });
      }
    }
  }

  // ---- 2. MainButton configured but never pressed ----
  const setMainBtn = outEvts.filter((l) => l.eventType === 'web_app_setup_main_button');
  const mainPressed = inEvts.filter((l) => l.eventType === 'main_button_pressed');
  if (setMainBtn.length > 0 && mainPressed.length === 0) {
    warnings.push({
      severity: 'medium',
      message: 'MainButton configured via setParams but MainButton.show() may be missing',
      detail: 'After WebApp.MainButton.setParams({ text, ... }), call WebApp.MainButton.show() to make the button visible. The user cannot press what they cannot see.',
    });
  }

  // ---- 3. showPopup without popupClosed ----
  const popupShown = outEvts.some((l) => l.eventType === 'web_app_open_popup');
  const popupClosed = inEvts.some((l) => l.eventType === 'popup_closed');
  if (popupShown && !popupClosed) {
    warnings.push({
      severity: 'medium',
      message: 'showPopup called but popupClosed event was never received',
      detail: 'Register an event handler: WebApp.onEvent("popupClosed", ({ button_id }) => { ... }). Without it, user choices inside popups are silently lost.',
    });
  }

  // ---- 4. sendData with near-empty payload ----
  const sendDataEvents = outEvts.filter((l) => l.eventType === 'web_app_data_send');
  for (const sd of sendDataEvents) {
    const d = sd.data as string | undefined;
    if (typeof d === 'string' && d.length < 3) {
      warnings.push({
        severity: 'low',
        message: `sendData called with near-empty payload: "${d}"`,
        detail: 'Use a structured JSON payload with at least an action field, e.g. JSON.stringify({ action: "save", data: {...} }).',
      });
      break;
    }
  }

  // ---- 5. close() called immediately ----
  const closeEvts = outEvts.filter((l) => l.eventType === 'web_app_close');
  const firstTs = logs.length > 0 ? logs[0].ts : Date.now();
  for (const ce of closeEvts) {
    if (ce.ts - firstTs < 2000) {
      warnings.push({
        severity: 'high',
        message: `web_app_close called ${ce.ts - firstTs}ms after first event — app closed instantly`,
        detail: 'Check for early-exit conditions, unhandled exceptions, or a misconfigured initialization flow.',
      });
      break;
    }
  }

  // ---- 6. ready() called late or never ----
  const readyIdx = outEvts.findIndex((l) => l.eventType === 'web_app_ready');
  if (readyIdx === -1) {
    warnings.push({
      severity: 'high',
      message: 'WebApp.ready() was never called',
      detail: 'Every Mini App must call WebApp.ready() to signal that initialization is complete. Without it, the loading spinner never disappears, and the app may appear frozen to users.',
    });
  } else if (readyIdx > 5) {
    warnings.push({
      severity: 'medium',
      message: `WebApp.ready() called after ${readyIdx} other API calls — should be called early`,
      detail: 'Call WebApp.ready() as soon as the app is ready to be displayed. Currently it fires after expand(), setParams(), etc. — the user sees a spinner longer than necessary.',
    });
  }

  // ---- 7. Excessive theme/style changes (potential flicker) ----
  const headerColorCalls = outEvts.filter((l) => l.eventType === 'web_app_set_header_color');
  if (headerColorCalls.length >= 4) {
    warnings.push({
      severity: 'low',
      message: `setHeaderColor called ${headerColorCalls.length}× — possible theme flicker`,
      detail: 'Frequent header color changes can cause visual flicker. Consider debouncing or limiting to a single call on initial load.',
    });
  }

  // ---- 8. HapticFeedback used without user-gesture context ----
  const hapticCalls = outEvts.filter((l) =>
    l.eventType === 'web_app_trigger_haptic_feedback'
  );
  if (hapticCalls.length >= 3 && inEvts.length === 0) {
    warnings.push({
      severity: 'low',
      message: `HapticFeedback triggered ${hapticCalls.length}× without any incoming events (user interaction?)`,
      detail: 'HapticFeedback should be triggered in response to user actions (button presses, gestures). Calling it on app init or in loops degrades UX and may be ignored by the client.',
    });
  }

  // ---- Build stats ----
  const statMap = new Map<string, number>();
  let minTs = Infinity;
  let maxTs = 0;
  for (const l of logs) {
    statMap.set(l.eventType, (statMap.get(l.eventType) || 0) + 1);
    if (l.ts < minTs) minTs = l.ts;
    if (l.ts > maxTs) maxTs = l.ts;
  }
  const stats: EventStats[] = Array.from(statMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Last 25 raw events for AI to inspect
  const rawEvents = logs.slice(-25);

  return {
    appUrl,
    scenario,
    durationMs: logs.length > 0 ? maxTs - minTs : 0,
    totalEvents: logs.length,
    warnings,
    stats,
    rawEvents,
  };
}

export function reportToMarkdown(report: AnalyzerReport): string {
  const lines: string[] = [
    '## TMA DevKit — AI Analysis Report',
    '',
    `**App:** \`${report.appUrl}\``,
    `**Scenario:** ${report.scenario}`,
    `**Duration:** ${(report.durationMs / 1000).toFixed(1)}s | **Events:** ${report.totalEvents}`,
    '',
  ];

  if (report.warnings.length > 0) {
    lines.push(`### ⚠️ Warnings (${report.warnings.length})`);
    lines.push('');
    for (let i = 0; i < report.warnings.length; i++) {
      const w = report.warnings[i];
      const icon = w.severity === 'high' ? '🔴' : w.severity === 'medium' ? '🟡' : '⚪';
      lines.push(`${i + 1}. ${icon} **${w.message}**`);
      if (w.detail) {
        lines.push(`   > ${w.detail}`);
      }
      lines.push('');
    }
  } else {
    lines.push('### ✅ No warnings detected');
    lines.push('');
    lines.push('All checks passed. No duplicate API calls, missing event handlers, or suspicious patterns found.');
    lines.push('');
  }

  if (report.stats.length > 0) {
    lines.push('### 📊 Event Breakdown');
    lines.push('');
    lines.push('| Event | Count |');
    lines.push('|-------|------:|');
    for (const s of report.stats) {
      lines.push(`| \`${s.name}\` | ${s.count} |`);
    }
    lines.push('');
  }

  if (report.rawEvents.length > 0) {
    lines.push('### 🔬 Raw Events (last 25)');
    lines.push('');
    lines.push('```json');
    for (const e of report.rawEvents) {
      const ts = new Date(e.ts).toISOString().replace('T', ' ').slice(0, 23);
      const dir = e.dir === 'out' ? 'OUT' : 'IN ';
      const data = JSON.stringify(e.data);
      lines.push(`[${ts}] ${dir} ${e.eventType} ${data === '{}' ? '' : data}`);
    }
    lines.push('```');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('**For AI analysis:** review the warnings above, then examine the raw events for additional patterns. Common issues to look for:');
  lines.push('- Events fired in wrong order (e.g. API calls before `ready()`)');
  lines.push('- Missing `onEvent` subscriptions (`popupClosed`, `mainButtonClicked`, `backButtonClicked`)');
  lines.push('- Duplicate API calls suggesting re-render loops');
  lines.push('- Missing error handling in callback-based methods (`CloudStorage.setItem`, `sendData`)');
  lines.push('');
  lines.push('*Generated by [TMA DevKit](https://github.com/Deus-org/tma-devkit)*');
  return lines.join('\n');
}