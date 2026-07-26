// Quick smoke test: verify headless launch collects events from demo app
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockScript = readFileSync(resolve(__dirname, '..', 'public', 'tma-devkit.js'), 'utf-8');

const collectorScript = `
  window.__tmaDevkitEvents__ = [];
  window.addEventListener('DOMContentLoaded', function() {
    var TgWebView = (window.Telegram && window.Telegram.WebView) || {};
    var origReceive = TgWebView.receiveEvent;
    TgWebView.receiveEvent = function(eventType, eventData) {
      window.__tmaDevkitEvents__.push({ type: eventType, dir: 'in', ts: Date.now(), data: eventData || {} });
      if (origReceive) return origReceive.call(this, eventType, eventData);
    };
    var origPost = TgWebView.postEvent;
    if (origPost) {
      TgWebView.postEvent = function(eventType, eventData, onComplete) {
        window.__tmaDevkitEvents__.push({ type: eventType, dir: 'out', ts: Date.now(), data: eventData || {} });
        return origPost.call(this, eventType, eventData, onComplete);
      };
    }
  });
`;

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const config = {
  platform: 'ios',
  version: '8.0',
  colorScheme: 'dark',
  themeParams: {
    bg_color: '#17212b', text_color: '#f5f5f5', hint_color: '#708499', link_color: '#6ab2f2',
    button_color: '#5288c1', button_text_color: '#ffffff', secondary_bg_color: '#232e3c',
    header_bg_color: '#17212b', bottom_bar_bg_color: '#232e3c', accent_text_color: '#6ab2f2',
    section_bg_color: '#17212b', section_header_text_color: '#6ab2f2', section_separator_color: '#111921',
    subtitle_text_color: '#708499', destructive_text_color: '#ff595a',
  },
  user: { id: 424242, first_name: 'Test', last_name: 'User', username: 'test_dev', language_code: 'en', is_premium: true },
  botToken: '123456789:DEVKIT_TEST_TOKEN',
  viewport: { height: 844, stableHeight: 844, isExpanded: true },
};

const encoded = base64UrlEncode(JSON.stringify(config));
const launchUrl = `http://localhost:5188/demo/index.html#tma_devkit=${encoded}`;

console.log('Launching headless browser...');
console.log('Mock script size:', mockScript.length, 'bytes');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });

page.on('console', (msg) => {
  if (msg.text().includes('[tma-devkit]')) console.log('  PAGE LOG:', msg.text());
});
page.on('pageerror', (err) => console.error('  PAGE ERROR:', err.message));

await page.addInitScript({ content: mockScript });
await page.addInitScript({ content: collectorScript });

try {
  await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
} catch (err) {
  console.error('Navigation failed:', err.message);
  await browser.close();
  process.exit(1);
}

console.log('Page loaded, waiting 3s for events...');
await page.waitForTimeout(3000);

const events = await page.evaluate(() => window.__tmaDevkitEvents__ || []);
console.log(`\nCollected ${events.length} events:`);

const stats = {};
for (const e of events) {
  stats[e.type] = (stats[e.type] || 0) + 1;
}

for (const [name, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name}: ${count}`);
}

// Check for key events
const hasReady = events.some(e => e.type === 'web_app_ready');
const hasExpand = events.some(e => e.type === 'web_app_expand');

console.log('');
if (hasReady && hasExpand) {
  console.log('✅ Headless launch SUCCESS — Mini App loaded and bridge events collected');
} else if (hasReady) {
  console.log('🟡 Partial success — ready() detected but no expand()');
} else {
  console.log('❌ FAILURE — no web_app_ready event. Mock may not have activated.');
  console.log('   Debug: page title =', await page.title());
  console.log('   Debug: window.Telegram =', await page.evaluate(() => !!window.Telegram));
}

await browser.close();
console.log('Browser closed.');