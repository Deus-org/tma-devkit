/// <reference types="vitest" />
import {
  defaultConfig,
  base64UrlEncode,
  base64UrlDecode,
  toWireConfig,
  buildIframeUrl,
  isDevkitControlMessage,
  isBridgeEvent,
  DEVKIT_SOURCE,
  THEME_DARK,
} from './devkit';

describe('base64Url encode/decode', () => {
  it('round-trips JSON config', () => {
    const config = defaultConfig();
    const encoded = base64UrlEncode(JSON.stringify(config));
    const decoded = JSON.parse(base64UrlDecode(encoded));
    expect(decoded.url).toBe('/demo/index.html');
    expect(decoded.platform).toBe('ios');
    expect(decoded.user.id).toBe(424242);
  });

  it('encodes without trailing = padding', () => {
    const encoded = base64UrlEncode('hello');
    expect(encoded).not.toContain('=');
  });

  it('uses URL-safe characters only', () => {
    const encoded = base64UrlEncode(JSON.stringify({ a: 1, b: 2 }));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('handles empty string', () => {
    expect(base64UrlDecode(base64UrlEncode(''))).toBe('');
  });

  it('handles unicode', () => {
    const input = 'привет мир! 🌍';
    expect(base64UrlDecode(base64UrlEncode(input))).toBe(input);
  });
});

describe('defaultConfig', () => {
  it('returns a valid config with all required fields', () => {
    const c = defaultConfig();
    expect(c.url).toBe('/demo/index.html');
    expect(c.platform).toBe('ios');
    expect(c.version).toBe('8.0');
    expect(c.colorScheme).toBe('dark');
    expect(c.user.is_premium).toBe(true);
    expect(c.botToken).toContain('DEVKIT_TEST_TOKEN');
    expect(c.viewport.width).toBe(390);
    expect(c.viewport.height).toBe(844);
  });

  it('theme params match dark theme', () => {
    const c = defaultConfig();
    expect(c.themeParams.bg_color).toBe(THEME_DARK.bg_color);
  });
});

describe('toWireConfig', () => {
  it('strips panel-only fields (width)', () => {
    const c = defaultConfig();
    const wire = toWireConfig(c);
    expect(wire).not.toHaveProperty('width');
    expect(wire.platform).toBe('ios');
    expect(wire.viewport.height).toBe(c.viewport.height);
  });

  it('includes startParam when set', () => {
    const c = { ...defaultConfig(), startParam: 'test123' };
    const wire = toWireConfig(c);
    expect(wire.startParam).toBe('test123');
  });

  it('omits startParam when empty', () => {
    const c = { ...defaultConfig(), startParam: '' };
    const wire = toWireConfig(c);
    expect(wire).not.toHaveProperty('startParam');
  });
});

describe('buildIframeUrl', () => {
  it('appends tma_devkit hash fragment', () => {
    const c = defaultConfig();
    const url = buildIframeUrl(c);
    expect(url).toMatch(/\/demo\/index\.html#tma_devkit=/);
  });

  it('handles custom url', () => {
    const c = { ...defaultConfig(), url: 'https://localhost:5173/myapp' };
    const url = buildIframeUrl(c);
    expect(url.startsWith('https://localhost:5173/myapp#tma_devkit=')).toBe(true);
  });

  it('strips existing hash from url', () => {
    const c = { ...defaultConfig(), url: '/demo/#oldhash' };
    const url = buildIframeUrl(c);
    expect(url).not.toContain('oldhash');
    expect(url).toMatch(/\/demo\/#tma_devkit=/);
  });
});

describe('isDevkitControlMessage', () => {
  it('identifies a hello message', () => {
    const msg = { source: DEVKIT_SOURCE, type: 'hello', state: null };
    expect(isDevkitControlMessage(msg)).toBe(true);
  });

  it('identifies an ack message', () => {
    const msg = { source: DEVKIT_SOURCE, type: 'ack', state: {} };
    expect(isDevkitControlMessage(msg)).toBe(true);
  });

  it('rejects non-object values', () => {
    expect(isDevkitControlMessage(null)).toBe(false);
    expect(isDevkitControlMessage('string')).toBe(false);
    expect(isDevkitControlMessage(42)).toBe(false);
  });

  it('rejects messages without source', () => {
    expect(isDevkitControlMessage({ type: 'hello', state: null })).toBe(false);
  });

  it('rejects bridge events', () => {
    expect(isDevkitControlMessage({ eventType: 'web_app_ready', eventData: {} })).toBe(false);
  });
});

describe('isBridgeEvent', () => {
  it('identifies valid bridge events', () => {
    expect(isBridgeEvent({ eventType: 'web_app_ready', eventData: {} })).toBe(true);
    expect(isBridgeEvent({ eventType: 'viewport_changed', eventData: { height: 700 } })).toBe(true);
  });

  it('rejects non-object values', () => {
    expect(isBridgeEvent(null)).toBe(false);
    expect(isBridgeEvent('web_app_ready')).toBe(false);
    expect(isBridgeEvent(42)).toBe(false);
  });

  it('rejects objects without eventType', () => {
    expect(isBridgeEvent({ eventData: {} })).toBe(false);
  });

  it('rejects devkit control messages', () => {
    expect(isBridgeEvent({ source: DEVKIT_SOURCE, type: 'hello' })).toBe(false);
  });
});