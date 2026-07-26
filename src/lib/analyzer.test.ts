/// <reference types="vitest" />
import { analyzeLogs, reportToMarkdown, type AnalyzerReport } from './analyzer';
import type { BridgeLogEntry } from './devkit';

function entry(
  ts: number,
  dir: 'out' | 'in',
  eventType: string,
  data?: unknown,
): BridgeLogEntry {
  return { id: Math.random(), ts, dir, eventType, data: data ?? {} };
}

describe('analyzeLogs', () => {
  it('detects duplicate expand() calls in a tight group', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1010, 'out', 'web_app_expand'),
      entry(1020, 'out', 'web_app_expand'),
      entry(1030, 'out', 'web_app_expand'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].severity).toBe('high');
    expect(report.warnings[0].message).toMatch(/web_app_expand called 3/);
  });

  it('does not flag expand() spread over time as duplicate', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1010, 'out', 'web_app_expand'),
      entry(2500, 'out', 'web_app_expand'), // 1.5s later — separate group
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    const expandWarnings = report.warnings.filter((w) => w.message.includes('web_app_expand'));
    expect(expandWarnings).toHaveLength(0);
  });

  it('warns when MainButton configured but never pressed', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1010, 'out', 'web_app_setup_main_button'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('MainButton'))).toBe(true);
  });

  it('does not warn MainButton if main_button_pressed received', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1010, 'out', 'web_app_setup_main_button'),
      entry(1200, 'in', 'main_button_pressed'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('MainButton'))).toBe(false);
  });

  it('warns when showPopup is called but popupClosed never received', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1100, 'out', 'web_app_open_popup'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('showPopup'))).toBe(true);
  });

  it('does not warn popup if popupClosed is received', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1100, 'out', 'web_app_open_popup'),
      entry(1200, 'in', 'popup_closed', { button_id: 'ok' }),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('showPopup'))).toBe(false);
  });

  it('warns on near-empty sendData payload', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1100, 'out', 'web_app_data_send', ''),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('sendData'))).toBe(true);
  });

  it('does not warn sendData with valid payload', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1100, 'out', 'web_app_data_send', '{"action":"save"}'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('sendData'))).toBe(false);
  });

  it('warns on close() called within 2 seconds', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1500, 'out', 'web_app_close'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('close'))).toBe(true);
  });

  it('warns when ready() is never called', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_expand'),
      entry(1100, 'out', 'web_app_data_send', '{"x":1}'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('ready() was never called'))).toBe(true);
  });

  it('warns when ready() is called late (after 5+ other API calls)', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_expand'),
      entry(1010, 'out', 'web_app_set_header_color'),
      entry(1020, 'out', 'web_app_setup_main_button'),
      entry(1030, 'out', 'web_app_trigger_haptic_feedback'),
      entry(1040, 'out', 'web_app_open_popup'),
      entry(1050, 'out', 'web_app_data_send', '{"x":1}'),
      entry(1060, 'out', 'web_app_ready'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('ready() called after'))).toBe(true);
  });

  it('warns on excessive setHeaderColor calls', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1010, 'out', 'web_app_set_header_color'),
      entry(1020, 'out', 'web_app_set_header_color'),
      entry(1030, 'out', 'web_app_set_header_color'),
      entry(1040, 'out', 'web_app_set_header_color'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('setHeaderColor'))).toBe(true);
  });

  it('warns on haptic feedback without incoming events', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1010, 'out', 'web_app_trigger_haptic_feedback'),
      entry(1020, 'out', 'web_app_trigger_haptic_feedback'),
      entry(1030, 'out', 'web_app_trigger_haptic_feedback'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.warnings.some((w) => w.message.includes('HapticFeedback'))).toBe(true);
  });

  it('includes raw events in report', () => {
    const logs: BridgeLogEntry[] = [
      entry(1000, 'out', 'web_app_ready'),
      entry(1100, 'in', 'theme_changed'),
    ];
    const report = analyzeLogs(logs, '/demo', 'ios dark');
    expect(report.rawEvents).toHaveLength(2);
  });

  it('empty logs produce report with only ready-never-called warning', () => {
    const report = analyzeLogs([], '/demo', 'ios dark');
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].message).toContain('ready() was never called');
    expect(report.totalEvents).toBe(0);
    expect(report.durationMs).toBe(0);
  });
});

describe('reportToMarkdown', () => {
  it('generates Markdown with warnings section', () => {
    const report: AnalyzerReport = {
      appUrl: '/demo/index.html',
      scenario: 'ios dark · Premium User',
      durationMs: 500,
      totalEvents: 10,
      warnings: [
        { severity: 'high', message: 'web_app_close called 1000ms after first event', detail: 'Check early-exit.' },
      ],
      stats: [{ name: 'web_app_ready', count: 1 }, { name: 'web_app_expand', count: 3 }],
      rawEvents: [],
    };
    const md = reportToMarkdown(report);
    expect(md).toContain('## TMA DevKit');
    expect(md).toContain('⚠️ Warnings (1)');
    expect(md).toContain('🔴');
    expect(md).toContain('web_app_close');
  });

  it('shows no-warnings section when clean', () => {
    const report: AnalyzerReport = {
      appUrl: '/demo/index.html',
      scenario: 'android light · Free User',
      durationMs: 300,
      totalEvents: 2,
      warnings: [],
      stats: [],
      rawEvents: [],
    };
    const md = reportToMarkdown(report);
    expect(md).toContain('✅ No warnings detected');
    expect(md).not.toContain('⚠️ Warnings');
  });

  it('includes event breakdown table', () => {
    const report: AnalyzerReport = {
      appUrl: '/demo/index.html',
      scenario: 'ios dark',
      durationMs: 100,
      totalEvents: 3,
      warnings: [],
      stats: [{ name: 'web_app_ready', count: 1 }],
      rawEvents: [],
    };
    const md = reportToMarkdown(report);
    expect(md).toContain('| Event | Count |');
    expect(md).toContain('| `web_app_ready` | 1 |');
  });

  it('includes raw events when present', () => {
    const report: AnalyzerReport = {
      appUrl: '/demo/index.html',
      scenario: 'ios dark',
      durationMs: 100,
      totalEvents: 1,
      warnings: [],
      stats: [],
      rawEvents: [entry(1000, 'out', 'web_app_ready')],
    };
    const md = reportToMarkdown(report);
    expect(md).toContain('### 🔬 Raw Events');
    expect(md).toContain('web_app_ready');
  });

  it('includes AI guidance section', () => {
    const md = reportToMarkdown({
      appUrl: '/demo/index.html',
      scenario: 'ios dark',
      durationMs: 100,
      totalEvents: 0,
      warnings: [],
      stats: [],
      rawEvents: [],
    });
    expect(md).toContain('**For AI analysis:**');
    expect(md).toContain('Missing `onEvent` subscriptions');
  });
});