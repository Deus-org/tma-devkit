/*!
 * TMA DevKit — Telegram Mini Apps mock environment
 * https://github.com/tma-devkit/tma-devkit (MIT)
 *
 * Drop-in development emulator for telegram-web-app.js. Add to your app's
 * index.html during development, BEFORE any other scripts:
 *
 *   <script src="https://your-host/tma-devkit.js"></script>
 *
 * The script stays completely dormant (no window.Telegram, no DOM changes, no
 * console output) unless it finds a devkit config:
 *
 *   a) URL hash channel:  #tma_devkit=<base64url(JSON config)>
 *      (the devkit panel appends this to your app URL; the fragment is parsed
 *      and replaced with real Telegram launch params on load)
 *   b) postMessage channel:  {source:'tma-devkit', type:'setConfig', config}
 *      (used by the panel to push live theme/viewport changes without reload)
 *
 * Bridge wire format, event names and API surface replicate the official
 * https://telegram.org/js/telegram-web-app.js — verified against its source.
 *
 * initData signing: the `hash` field is computed synchronously at parse time
 * with an embedded HMAC-SHA256 implementation following
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * so window.Telegram.WebApp.initData is complete before DOMContentLoaded —
 * no async race with your app code. window.__tmaDevkitReady resolves once the
 * environment is fully applied (and the embedded HMAC has been cross-checked
 * against Web Crypto where available).
 */
(function () {
  'use strict';

  var SOURCE = 'tma-devkit';
  var CONFIG_HASH_KEY = 'tma_devkit';
  var DEFAULT_BOT_TOKEN = '123456789:DEVKIT_TEST_TOKEN';

  /* ======================================================================
   * DEVKIT-HMAC-BEGIN — pure byte-level SHA-256 / HMAC-SHA256 (FIPS 180-4).
   * Kept dependency-free and synchronous on purpose (see header comment).
   * This exact block is extracted and unit-tested against node:crypto by
   * scripts/verify-hmac.mjs — keep the markers intact.
   * ==================================================================== */
  function dkUtf8Bytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          var cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          bytes.push(
            0xf0 | (cp >> 18),
            0x80 | ((cp >> 12) & 0x3f),
            0x80 | ((cp >> 6) & 0x3f),
            0x80 | (cp & 0x3f)
          );
          i++;
        } else {
          bytes.push(0xef, 0xbf, 0xbd);
        }
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return bytes;
  }

  function dkSha256Bytes(data) {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

    function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

    var msg = data.slice();
    var bitLenHi = Math.floor((msg.length * 8) / 0x100000000);
    var bitLenLo = (msg.length * 8) >>> 0;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    msg.push(
      (bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255,
      (bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255
    );

    var w = new Array(64);
    for (var block = 0; block < msg.length; block += 64) {
      for (var t = 0; t < 16; t++) {
        var j = block + t * 4;
        w[t] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
        var s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = [];
    for (var i = 0; i < 8; i++) {
      out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
    }
    return out;
  }

  function dkHmacSha256Bytes(keyBytes, messageBytes) {
    var key = keyBytes.slice();
    if (key.length > 64) key = dkSha256Bytes(key);
    while (key.length < 64) key.push(0);
    var ipad = new Array(64), opad = new Array(64);
    for (var i = 0; i < 64; i++) {
      ipad[i] = key[i] ^ 0x36;
      opad[i] = key[i] ^ 0x5c;
    }
    return dkSha256Bytes(opad.concat(dkSha256Bytes(ipad.concat(messageBytes))));
  }

  function dkBytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return hex;
  }

  /**
   * Telegram initData `hash`, exactly per
   * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
   *   secret = HMAC_SHA256(key="WebAppData", data=bot_token)
   *   hash   = hex(HMAC_SHA256(key=secret, data=data_check_string))
   */
  function dkTelegramInitDataHash(dataCheckString, botToken) {
    var secret = dkHmacSha256Bytes(dkUtf8Bytes('WebAppData'), dkUtf8Bytes(botToken));
    return dkBytesToHex(dkHmacSha256Bytes(secret, dkUtf8Bytes(dataCheckString)));
  }
  /* DEVKIT-HMAC-END */

  /* ---------------- small utils ---------------- */

  function log() {
    if (window.console && console.log) {
      var args = ['[tma-devkit]'];
      for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
      console.log.apply(console, args);
    }
  }

  function urlSafeDecode(urlencoded) {
    try {
      urlencoded = urlencoded.replace(/\+/g, '%20');
      return decodeURIComponent(urlencoded);
    } catch (e) {
      return urlencoded;
    }
  }

  function urlParseHashParams(locationHash) {
    locationHash = locationHash.replace(/^#/, '');
    var params = {};
    if (!locationHash.length) return params;
    if (locationHash.indexOf('=') < 0 && locationHash.indexOf('?') < 0) {
      params._path = urlSafeDecode(locationHash);
      return params;
    }
    var qIndex = locationHash.indexOf('?');
    if (qIndex >= 0) {
      params._path = urlSafeDecode(locationHash.substr(0, qIndex));
      locationHash = locationHash.substr(qIndex + 1);
    }
    var parts = locationHash.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      params[urlSafeDecode(kv[0])] = kv[1] == null ? null : urlSafeDecode(kv[1]);
    }
    return params;
  }

  function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var bin = atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // UTF-8 aware decode
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      var s = '';
      for (var j = 0; j < bytes.length; j++) s += String.fromCharCode(bytes[j]);
      return decodeURIComponent(escape(s));
    }
  }

  function strTrim(str) {
    return str.toString().replace(/^\s+|\s+$/g, '');
  }

  function byteLength(str) {
    var s = str.length;
    for (var i = str.length - 1; i >= 0; i--) {
      var code = str.charCodeAt(i);
      if (code > 0x7f && code <= 0x7ff) s++;
      else if (code > 0x7ff && code <= 0xffff) s += 2;
      if (code >= 0xdc00 && code <= 0xdfff) i--;
    }
    return s;
  }

  function parseColorToHex(color) {
    color += '';
    var match;
    if ((match = color.match(/#([0-9a-fA-F]{6})/))) return '#' + match[1].toLowerCase();
    if ((match = color.match(/#([0-9a-fA-F]{3})/))) {
      var r = match[1];
      return '#' + r[0] + r[0] + r[1] + r[1] + r[2] + r[2];
    }
    return null;
  }

  function isColorDark(rgb) {
    var color = parseColorToHex(rgb);
    if (!color) return false;
    var r = parseInt(color.substr(1, 2), 16);
    var g = parseInt(color.substr(3, 2), 16);
    var b = parseInt(color.substr(5, 2), 16);
    var hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
    return hsp < 127.5;
  }

  function versionCompare(v1, v2) {
    if (typeof v1 !== 'string' || typeof v2 !== 'string') return undefined;
    var p1 = v1.split('.'), p2 = v2.split('.');
    var l = Math.max(p1.length, p2.length);
    for (var i = 0; i < l; i++) {
      var a = parseInt(p1[i] || '0', 10) || 0;
      var b = parseInt(p2[i] || '0', 10) || 0;
      if (a !== b) return a < b ? -1 : 1;
    }
    return 0;
  }

  function generateCallbackId(len) {
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var id = '';
    for (var i = 0; i < len; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    return id;
  }

  function isIframe() {
    try {
      return window.parent != null && window !== window.parent;
    } catch (e) {
      return false;
    }
  }

  function postToParent(payload) {
    // Mirrors the official script's iframe branch:
    //   window.parent.postMessage(JSON.stringify({eventType, eventData}), '*')
    // In a standalone tab the official script reaches the {notAvailable:true}
    // branch and posts nothing — we do the same so no messages echo back.
    if (!isIframe()) return;
    try {
      window.parent.postMessage(JSON.stringify(payload), '*');
    } catch (e) {}
  }

  /* ---------------- default themes ---------------- */

  var DEFAULT_THEME_LIGHT = {
    bg_color: '#ffffff',
    text_color: '#000000',
    hint_color: '#999999',
    link_color: '#2481cc',
    button_color: '#5288c1',
    button_text_color: '#ffffff',
    secondary_bg_color: '#f1f1f1',
    header_bg_color: '#ffffff',
    bottom_bar_bg_color: '#e4e4e4',
    accent_text_color: '#168acd',
    section_bg_color: '#ffffff',
    section_header_text_color: '#168acd',
    section_separator_color: '#d9d9d9',
    subtitle_text_color: '#999999',
    destructive_text_color: '#c70000'
  };

  var DEFAULT_THEME_DARK = {
    bg_color: '#17212b',
    text_color: '#f5f5f5',
    hint_color: '#708499',
    link_color: '#6ab2f2',
    button_color: '#5288c1',
    button_text_color: '#ffffff',
    secondary_bg_color: '#232e3c',
    header_bg_color: '#17212b',
    bottom_bar_bg_color: '#232e3c',
    accent_text_color: '#6ab2f2',
    section_bg_color: '#17212b',
    section_header_text_color: '#6ab2f2',
    section_separator_color: '#111921',
    subtitle_text_color: '#708499',
    destructive_text_color: '#ff595a'
  };

  function defaultThemeForScheme(scheme) {
    var base = scheme === 'dark' ? DEFAULT_THEME_DARK : DEFAULT_THEME_LIGHT;
    var copy = {};
    for (var k in base) copy[k] = base[k];
    return copy;
  }

  /* ---------------- config intake ---------------- */

  function readHashConfig() {
    var hash = '';
    try {
      hash = location.hash.toString();
    } catch (e) {}
    if (!hash) return null;
    var params = urlParseHashParams(hash);
    var raw = params[CONFIG_HASH_KEY];
    if (!raw) return null;
    try {
      var json = base64UrlDecode(raw);
      var config = JSON.parse(json);
      if (!config || typeof config !== 'object') return null;
      return { config: config, params: params };
    } catch (e) {
      log('failed to parse #' + CONFIG_HASH_KEY + ' config:', e);
      return null;
    }
  }

  /**
   * Serializes launch params exactly the way @telegram-apps/sdk v3
   * (tma.js, packages/transformers/serializers.ts) does:
   * URLSearchParams encoding, booleans as '1'/'0', objects as JSON,
   * tgWebAppData as its own nested query string.
   */
  function serializeLaunchParams(lp) {
    var parts = [];
    for (var key in lp) {
      var value = lp[key];
      if (value === null || value === undefined) continue;
      if (typeof value === 'boolean') value = value ? '1' : '0';
      else if (typeof value === 'object') value = JSON.stringify(value);
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
    return parts.join('&');
  }

  /* ======================================================================
   * Activation
   * ==================================================================== */

  var activated = false;
  var readyResolve;
  window.__tmaDevkitReady = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  function activate(config) {
    if (activated) {
      applyLiveConfig(config, true);
      return;
    }
    activated = true;

    config = config || {};
    var colorScheme = config.colorScheme === 'dark' ? 'dark' : 'light';
    var themeParams = defaultThemeForScheme(colorScheme);
    if (config.themeParams && typeof config.themeParams === 'object') {
      for (var tk in config.themeParams) {
        var hex = parseColorToHex(config.themeParams[tk]);
        if (hex) themeParams[tk] = hex;
      }
    }
    var botToken = typeof config.botToken === 'string' && config.botToken ? config.botToken : DEFAULT_BOT_TOKEN;
    var platform = typeof config.platform === 'string' && config.platform ? config.platform : 'web';
    var version = typeof config.version === 'string' && config.version ? config.version : '8.0';

    var user = config.user && typeof config.user === 'object' ? config.user : null;

    /* ---- build + sign initData (Telegram docs flow) ---- */
    var initDataFields = {};
    if (user) initDataFields.user = JSON.stringify(user);
    initDataFields.auth_date = String(Math.floor(Date.now() / 1000));
    initDataFields.chat_type = config.chatType || 'sender';
    initDataFields.chat_instance = config.chatInstance || generateCallbackId(19).replace(/[^0-9]/g, '9');
    if (config.startParam) initDataFields.start_param = String(config.startParam);
    initDataFields.query_id = 'AA' + generateCallbackId(30);
    // The Ed25519 `signature` field (Bot API 8.0+, third-party validation) is
    // computed by Telegram with its private key and cannot be reproduced
    // locally — a deterministic placeholder keeps SDK v3 schema-parsing happy.
    // Validate `hash` instead; it is fully reproducible with the bot token.

    var checkKeys = [];
    for (var f in initDataFields) checkKeys.push(f);
    checkKeys.sort();
    var checkPairs = [];
    for (var ci = 0; ci < checkKeys.length; ci++) {
      checkPairs.push(checkKeys[ci] + '=' + initDataFields[checkKeys[ci]]);
    }
    var dataCheckString = checkPairs.join('\n');
    var hash = dkTelegramInitDataHash(dataCheckString, botToken);
    initDataFields.hash = hash;
    var signatureSrc = dkSha256Bytes(dkUtf8Bytes(botToken + ':' + dataCheckString))
      .concat(dkSha256Bytes(dkUtf8Bytes(dataCheckString + ':' + botToken)));
    var sigB64 = '';
    try {
      sigB64 = btoa(String.fromCharCode.apply(null, signatureSrc))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) {
      sigB64 = 'DEVKIT_SIGNATURE_PLACEHOLDER';
    }
    initDataFields.signature = sigB64;

    // Build the raw initData query string (values URL-encoded like Telegram).
    var initDataPairs = [];
    for (var dk in initDataFields) {
      initDataPairs.push(encodeURIComponent(dk) + '=' + encodeURIComponent(initDataFields[dk]));
    }
    var initDataRaw = initDataPairs.join('&');

    /* ---- launch params (SDK v3 / official script format) ---- */
    var launchParams = {
      tgWebAppPlatform: platform,
      tgWebAppVersion: version,
      tgWebAppThemeParams: JSON.stringify(themeParams),
      tgWebAppData: initDataRaw
    };
    if (config.startParam) launchParams.tgWebAppStartParam = String(config.startParam);
    if (config.botInline) launchParams.tgWebAppBotInline = '1';
    if (config.showSettings) launchParams.tgWebAppShowSettings = '1';

    var launchParamsQuery = serializeLaunchParams(launchParams);

    // 1) Replace the #tma_devkit= fragment with real-looking launch params so
    //    the official script / SDK reading location.hash see the real format.
    try {
      var base = location.href.split('#')[0];
      history.replaceState(null, '', base + '#' + launchParamsQuery);
    } catch (e) {}
    // 2) SDK v3 fallback source: sessionStorage 'tapps/launchParams'
    //    (JSON-stringified query, @tma.js/toolkit storage format).
    try {
      sessionStorage.setItem('tapps/launchParams', JSON.stringify(launchParamsQuery));
    } catch (e) {}

    /* ---- parse initDataUnsafe exactly like the official script ---- */
    var initDataUnsafe = {};
    (function () {
      var pairs = initDataRaw.split('&');
      for (var i = 0; i < pairs.length; i++) {
        var kv = pairs[i].split('=');
        var name = urlSafeDecode(kv[0]);
        var val = kv[1] == null ? null : urlSafeDecode(kv[1]);
        initDataUnsafe[name] = val;
      }
      for (var key in initDataUnsafe) {
        var v = initDataUnsafe[key];
        try {
          if (v && (v.substr(0, 1) === '{' && v.substr(-1) === '}' ||
                    v.substr(0, 1) === '[' && v.substr(-1) === ']')) {
            initDataUnsafe[key] = JSON.parse(v);
          }
        } catch (e) {}
      }
    })();

    buildTelegramEnv({
      config: config,
      botToken: botToken,
      platform: platform,
      version: version,
      colorScheme: colorScheme,
      themeParams: themeParams,
      initDataRaw: initDataRaw,
      initDataUnsafe: initDataUnsafe,
      launchParams: launchParams,
      viewportHeight: config.viewport && config.viewport.height,
      viewportStableHeight: config.viewport && config.viewport.stableHeight,
      isExpanded: !config.viewport || config.viewport.isExpanded !== false
    });
  }


  /* ======================================================================
   * The mocked window.Telegram environment
   * ==================================================================== */

  function buildTelegramEnv(env) {
    var config = env.config;
    var eventHandlers = {}; // raw wire-level handlers (WebView bus)

    function onRawEvent(eventType, callback) {
      if (eventHandlers[eventType] === undefined) eventHandlers[eventType] = [];
      if (eventHandlers[eventType].indexOf(callback) === -1) eventHandlers[eventType].push(callback);
    }
    function offRawEvent(eventType, callback) {
      var list = eventHandlers[eventType];
      if (!list) return;
      var i = list.indexOf(callback);
      if (i !== -1) list.splice(i, 1);
    }
    function callEventCallbacks(eventType, func) {
      var list = eventHandlers[eventType];
      if (!list || !list.length) return;
      for (var i = 0; i < list.length; i++) {
        try {
          func(list[i]);
        } catch (e) {}
      }
    }
    function receiveEvent(eventType, eventData) {
      // Official: console.log('[Telegram.WebView] < receiveEvent', ...)
      callEventCallbacks(eventType, function (callback) {
        callback(eventType, eventData);
      });
    }

    function postEvent(eventType, callback, eventData) {
      // Official signature: postEvent(eventType, callback, eventData)
      if (!callback) callback = function () {};
      if (eventData === undefined) eventData = '';
      postToParent({ eventType: eventType, eventData: eventData });
      callback();
    }

    /* ---------------- WebView facade (parity with official) ---------------- */
    var WebView = {
      initParams: env.launchParams,
      isIframe: isIframe(),
      onEvent: onRawEvent,
      offEvent: offRawEvent,
      postEvent: postEvent,
      receiveEvent: receiveEvent,
      callEventCallbacks: callEventCallbacks
    };

    /* ---------------- webview: camelCase bus (WebApp.onEvent) ---------------- */
    function receiveWebViewEvent(eventType) {
      var args = Array.prototype.slice.call(arguments, 1);
      callEventCallbacks('webview:' + eventType, function (callback) {
        callback.apply(WebApp, args);
      });
    }
    function onWebViewEvent(eventType, callback) {
      onRawEvent('webview:' + eventType, callback);
    }
    function offWebViewEvent(eventType, callback) {
      offRawEvent('webview:' + eventType, callback);
    }

    /* ---------------- state ---------------- */
    var webAppVersion = env.version;
    var webAppPlatform = env.platform;
    var themeParams = {};
    var colorScheme = env.colorScheme;
    var viewportHeight = false;
    var viewportStableHeight = false;
    var isExpanded = env.isExpanded;
    var bottomBarHeight = 0;
    var safeAreaInset = { top: 0, bottom: 0, left: 0, right: 0 };
    var contentSafeAreaInset = { top: 0, bottom: 0, left: 0, right: 0 };
    var webAppIsActive = true;
    var webAppIsFullscreen = false;
    var webAppIsOrientationLocked = false;
    var isClosingConfirmationEnabled = false;
    var isVerticalSwipesEnabled = true;
    var webAppHeaderColorKey = 'bg_color';
    var webAppHeaderColor = null;
    var webAppBackgroundColor = 'bg_color';
    var webAppBottomBarColor = 'bottom_bar_bg_color';
    var webAppCallbacks = {};
    var webAppPopupOpened = false;
    var webAppScanQrPopupOpened = false;
    var webAppInvoices = {};

    function versionAtLeast(ver) {
      return versionCompare(webAppVersion, ver) >= 0;
    }

    /* ---------------- CSS vars (official behavior) ---------------- */
    function setCssProperty(name, value) {
      var root = document.documentElement;
      if (root && root.style && root.style.setProperty) {
        root.style.setProperty('--tg-' + name, value);
      }
    }

    function setThemeParams(theme_params, skipCss) {
      if (theme_params.bg_color === '#1c1c1d' &&
          theme_params.bg_color === theme_params.secondary_bg_color) {
        theme_params.secondary_bg_color = '#2c2c2e';
      }
      var color;
      for (var key in theme_params) {
        if ((color = parseColorToHex(theme_params[key]))) {
          themeParams[key] = color;
          if (!skipCss) {
            setCssProperty('theme-' + key.split('_').join('-'), color);
          }
        }
      }
    }

    function setColorScheme(scheme) {
      colorScheme = scheme === 'dark' ? 'dark' : 'light';
      setCssProperty('color-scheme', colorScheme);
    }

    function setViewportHeight(data) {
      if (typeof data !== 'undefined') {
        if (data.is_expanded !== undefined) isExpanded = !!data.is_expanded;
        if (data.height !== undefined) {
          viewportHeight = data.height;
          if (data.is_state_stable) viewportStableHeight = data.height;
        }
        receiveWebViewEvent('viewportChanged', {
          isStateStable: !!data.is_state_stable
        });
      }
      var h = currentViewportHeight();
      setCssProperty('viewport-height', h + 'px');
      setCssProperty('viewport-stable-height', currentViewportStableHeight() + 'px');
    }

    function currentViewportHeight() {
      var base = viewportHeight !== false ? viewportHeight : window.innerHeight;
      return Math.max(0, base - bottomBarHeight);
    }
    function currentViewportStableHeight() {
      var base = viewportStableHeight !== false ? viewportStableHeight : window.innerHeight;
      return Math.max(0, base - bottomBarHeight);
    }

    function setSafeAreaInset(data) {
      if (!data) return;
      ['top', 'bottom', 'left', 'right'].forEach(function (k) {
        if (typeof data[k] !== 'undefined') safeAreaInset[k] = data[k];
        setCssProperty('safe-area-inset-' + k, safeAreaInset[k] + 'px');
      });
    }
    function setContentSafeAreaInset(data) {
      if (!data) return;
      ['top', 'bottom', 'left', 'right'].forEach(function (k) {
        if (typeof data[k] !== 'undefined') contentSafeAreaInset[k] = data[k];
        setCssProperty('content-safe-area-inset-' + k, contentSafeAreaInset[k] + 'px');
      });
    }

    /* ---------------- visual chrome (Main/Secondary/Back buttons) ---------------- */
    var chrome = {
      barEl: null,
      mainBtnEl: null,
      secondaryBtnEl: null,
      backBtnEl: null
    };

    function ensureChrome() {
      if (chrome.barEl || !document.body) return;
      var bar = document.createElement('div');
      bar.setAttribute('data-tma-devkit-chrome', 'bottom-bar');
      bar.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;' +
        'display:none;flex-direction:column;gap:8px;padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));' +
        'box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;';
      document.body.appendChild(bar);
      chrome.barEl = bar;

      var back = document.createElement('button');
      back.setAttribute('data-tma-devkit-chrome', 'back-button');
      back.style.cssText =
        'position:fixed;top:10px;left:10px;z-index:2147483001;display:none;' +
        'align-items:center;justify-content:center;width:36px;height:36px;border:none;' +
        'border-radius:10px;cursor:pointer;padding:0;background:transparent;';
      back.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      back.addEventListener('click', function () {
        receiveEvent('back_button_pressed');
      });
      document.body.appendChild(back);
      chrome.backBtnEl = back;
    }

    function styleBottomButton(el, params) {
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.width = '100%';
      el.style.height = '48px';
      el.style.border = 'none';
      el.style.borderRadius = '10px';
      el.style.fontSize = '16px';
      el.style.fontWeight = '600';
      el.style.letterSpacing = '0.01em';
      el.style.cursor = params.is_active ? 'pointer' : 'default';
      el.style.opacity = params.is_active ? '1' : '0.6';
      el.style.backgroundColor = params.color;
      el.style.color = params.text_color;
      el.style.transition = 'transform 60ms ease, opacity 120ms ease';
      el.style.fontFamily = 'inherit';
      el.style.boxSizing = 'border-box';
      el.style.position = 'relative';
      el.style.overflow = 'hidden';
      el.textContent = params.text;
      if (params.is_progress_visible) {
        el.innerHTML = '';
        var sp = document.createElement('span');
        sp.style.cssText =
          'width:20px;height:20px;border-radius:50%;display:inline-block;' +
          'border:2.5px solid ' + params.text_color + ';border-top-color:transparent;' +
          'animation:tma-devkit-spin 0.8s linear infinite;';
        el.appendChild(sp);
        ensureSpinKeyframes();
      }
      el.onmousedown = function () { if (params.is_active) el.style.transform = 'scale(0.985)'; };
      el.onmouseup = function () { el.style.transform = ''; };
      el.onmouseleave = function () { el.style.transform = ''; };
      if (params.has_shine_effect) {
        ensureShineKeyframes();
        var shine = document.createElement('span');
        shine.style.cssText =
          'position:absolute;top:0;left:-60%;width:40%;height:100%;pointer-events:none;' +
          'background:linear-gradient(100deg,transparent 0%,rgba(255,255,255,0.35) 50%,transparent 100%);' +
          'animation:tma-devkit-shine 2.4s ease-in-out infinite;';
        el.appendChild(shine);
      }
    }

    var keyframesAdded = {};
    function ensureSpinKeyframes() {
      if (keyframesAdded.spin) return;
      keyframesAdded.spin = true;
      var st = document.createElement('style');
      st.textContent = '@keyframes tma-devkit-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(st);
    }
    function ensureShineKeyframes() {
      if (keyframesAdded.shine) return;
      keyframesAdded.shine = true;
      var st = document.createElement('style');
      st.textContent = '@keyframes tma-devkit-shine{0%{left:-60%}60%,100%{left:120%}}';
      document.head.appendChild(st);
    }

    function updateChrome() {
      ensureChrome();
      if (!chrome.barEl) return;
      var mainParams = MainButton.__params();
      var secParams = SecondaryButton.__params();
      var anyVisible = mainParams.is_visible || secParams.is_visible;

      // rebuild bar contents
      chrome.barEl.innerHTML = '';
      chrome.mainBtnEl = null;
      chrome.secondaryBtnEl = null;

      var stacked = anyVisible && mainParams.is_visible && secParams.is_visible &&
        (secParams.position === 'top' || secParams.position === 'bottom');

      if (anyVisible) {
        chrome.barEl.style.display = 'flex';
        chrome.barEl.style.backgroundColor = getBottomBarColor() || themeParams.bg_color || '#ffffff';

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;width:100%;' +
          (stacked ? 'flex-direction:column;' : 'flex-direction:row;');

        var mainEl = document.createElement('button');
        mainEl.setAttribute('data-tma-devkit-chrome', 'main-button');
        chrome.mainBtnEl = mainEl;

        var secEl = document.createElement('button');
        secEl.setAttribute('data-tma-devkit-chrome', 'secondary-button');
        chrome.secondaryBtnEl = secEl;

        if (mainParams.is_visible) {
          styleBottomButton(mainEl, mainParams);
          mainEl.addEventListener('click', function () {
            if (MainButton.isActive) receiveEvent('main_button_pressed');
          });
        } else {
          mainEl.style.display = 'none';
        }
        if (secParams.is_visible) {
          styleBottomButton(secEl, secParams);
          secEl.addEventListener('click', function () {
            if (SecondaryButton.isActive) receiveEvent('secondary_button_pressed');
          });
        } else {
          secEl.style.display = 'none';
        }

        if (secParams.is_visible && secParams.position === 'top' && mainParams.is_visible) {
          row.appendChild(secEl);
          row.appendChild(mainEl);
        } else if (secParams.is_visible && (secParams.position === 'left' || secParams.position === 'right') && mainParams.is_visible) {
          if (secParams.position === 'left') {
            row.appendChild(secEl);
            row.appendChild(mainEl);
          } else {
            row.appendChild(mainEl);
            row.appendChild(secEl);
          }
        } else {
          if (mainParams.is_visible) row.appendChild(mainEl);
          if (secParams.is_visible) row.appendChild(secEl);
        }
        chrome.barEl.appendChild(row);

        bottomBarHeight = stacked ? 112 : 64;
      } else {
        chrome.barEl.style.display = 'none';
        bottomBarHeight = 0;
      }

      // back button
      var backVisible = BackButton.isVisible;
      chrome.backBtnEl.style.display = backVisible ? 'flex' : 'none';
      chrome.backBtnEl.style.color = themeParams.text_color || '#000';

      // keep document content clear of the bar + refresh viewport vars
      document.body.style.paddingBottom = anyVisible ? bottomBarHeight + 'px' : '';
      setViewportHeight();
    }

    /* ---------------- BackButton ---------------- */
    var BackButton = (function () {
      var isVisible = false;
      var btn = {};
      Object.defineProperty(btn, 'isVisible', {
        set: function (val) { setParams({ is_visible: val }); },
        get: function () { return isVisible; },
        enumerable: true
      });
      function setParams(params) {
        if (typeof params.is_visible !== 'undefined') isVisible = !!params.is_visible;
        postEvent('web_app_setup_back_button', false, { is_visible: isVisible });
        updateChrome();
        return btn;
      }
      btn.onClick = function (cb) { onWebViewEvent('backButtonClicked', cb); return btn; };
      btn.offClick = function (cb) { offWebViewEvent('backButtonClicked', cb); return btn; };
      btn.show = function () { return setParams({ is_visible: true }); };
      btn.hide = function () { return setParams({ is_visible: false }); };
      btn.__setParams = setParams;
      return btn;
    })();

    /* ---------------- SettingsButton ---------------- */
    var SettingsButton = (function () {
      var isVisible = false;
      var btn = {};
      Object.defineProperty(btn, 'isVisible', {
        set: function (val) { setParams({ is_visible: val }); },
        get: function () { return isVisible; },
        enumerable: true
      });
      function setParams(params) {
        if (typeof params.is_visible !== 'undefined') isVisible = !!params.is_visible;
        postEvent('web_app_setup_settings_button', false, { is_visible: isVisible });
        return btn;
      }
      btn.onClick = function (cb) { onWebViewEvent('settingsButtonClicked', cb); return btn; };
      btn.offClick = function (cb) { offWebViewEvent('settingsButtonClicked', cb); return btn; };
      btn.show = function () { return setParams({ is_visible: true }); };
      btn.hide = function () { return setParams({ is_visible: false }); };
      return btn;
    })();

    /* ---------------- BottomButton (Main + Secondary) ---------------- */
    function BottomButtonConstructor(type) {
      var isMainButton = type === 'main';
      var setupFnName = isMainButton ? 'web_app_setup_main_button' : 'web_app_setup_secondary_button';
      var webViewEventName = isMainButton ? 'mainButtonClicked' : 'secondaryButtonClicked';
      var defaultText = isMainButton ? 'Continue' : 'Cancel';

      var isVisible = false;
      var isActive = true;
      var hasShineEffect = false;
      var isProgressVisible = false;
      var buttonText = defaultText;
      var buttonColor = false;
      var buttonTextColor = false;
      var buttonPosition = 'left';

      function defaultColor() {
        return isMainButton
          ? (themeParams.button_color || '#2481cc')
          : (getBottomBarColor() || '#2481cc');
      }
      function defaultTextColor() {
        return isMainButton
          ? (themeParams.button_text_color || '#ffffff')
          : (themeParams.button_color || '#ffffff');
      }

      var btn = {};
      Object.defineProperty(btn, 'type', { get: function () { return type; }, enumerable: true });
      Object.defineProperty(btn, 'text', {
        set: function (v) { setParams({ text: v }); },
        get: function () { return buttonText; },
        enumerable: true
      });
      Object.defineProperty(btn, 'color', {
        set: function (v) { setParams({ color: v }); },
        get: function () { return buttonColor || defaultColor(); },
        enumerable: true
      });
      Object.defineProperty(btn, 'textColor', {
        set: function (v) { setParams({ text_color: v }); },
        get: function () { return buttonTextColor || defaultTextColor(); },
        enumerable: true
      });
      Object.defineProperty(btn, 'isVisible', {
        set: function (v) { setParams({ is_visible: v }); },
        get: function () { return isVisible; },
        enumerable: true
      });
      Object.defineProperty(btn, 'isActive', {
        set: function (v) { setParams({ is_active: v }); },
        get: function () { return isActive; },
        enumerable: true
      });
      Object.defineProperty(btn, 'isProgressVisible', {
        get: function () { return isProgressVisible; },
        enumerable: true
      });
      Object.defineProperty(btn, 'hasShineEffect', {
        set: function (v) { setParams({ has_shine_effect: v }); },
        get: function () { return hasShineEffect; },
        enumerable: true
      });
      if (!isMainButton) {
        Object.defineProperty(btn, 'position', {
          set: function (v) { setParams({ position: v }); },
          get: function () { return buttonPosition; },
          enumerable: true
        });
      }

      function buttonParams() {
        if (!isVisible) return { is_visible: false };
        var params = {
          is_visible: true,
          is_active: isActive,
          is_progress_visible: isProgressVisible,
          text: buttonText,
          color: btn.color,
          text_color: btn.textColor,
          has_shine_effect: hasShineEffect && isActive && !isProgressVisible
        };
        if (!isMainButton) params.position = buttonPosition;
        return params;
      }

      function setParams(params) {
        params = params || {};
        if (typeof params.text !== 'undefined') {
          var text = strTrim(params.text);
          if (!text.length) {
            console.error('[Telegram.WebApp] Bottom button text is required', params.text);
            throw Error('WebAppButtonTextInvalid');
          }
          buttonText = text;
        }
        if (typeof params.color !== 'undefined') {
          var c = parseColorToHex(params.color);
          if (c) buttonColor = c;
        }
        if (typeof params.text_color !== 'undefined') {
          var tc = parseColorToHex(params.text_color);
          if (tc) buttonTextColor = tc;
        }
        if (typeof params.is_visible !== 'undefined') isVisible = !!params.is_visible;
        if (typeof params.is_active !== 'undefined') isActive = !!params.is_active;
        if (typeof params.has_shine_effect !== 'undefined') hasShineEffect = !!params.has_shine_effect;
        if (typeof params.position !== 'undefined' && !isMainButton) {
          if (['left', 'right', 'top', 'bottom'].indexOf(params.position) !== -1) {
            buttonPosition = params.position;
          }
        }
        postEvent(setupFnName, false, buttonParams());
        updateChrome();
        return btn;
      }

      btn.setParams = setParams;
      btn.onClick = function (cb) { onWebViewEvent(webViewEventName, cb); return btn; };
      btn.offClick = function (cb) { offWebViewEvent(webViewEventName, cb); return btn; };
      btn.show = function () { return setParams({ is_visible: true }); };
      btn.hide = function () { return setParams({ is_visible: false }); };
      btn.enable = function () { return setParams({ is_active: true }); };
      btn.disable = function () { return setParams({ is_active: false }); };
      btn.showProgress = function (leaveActive) {
        isProgressVisible = true;
        if (!leaveActive) isActive = false;
        postEvent(setupFnName, false, buttonParams());
        updateChrome();
        return btn;
      };
      btn.hideProgress = function () {
        isProgressVisible = false;
        if (!isActive) isActive = true;
        postEvent(setupFnName, false, buttonParams());
        updateChrome();
        return btn;
      };
      btn.setText = function (text) { return setParams({ text: text }); };
      btn.__params = buttonParams;
      return btn;
    }

    var MainButton = BottomButtonConstructor('main');
    var SecondaryButton = BottomButtonConstructor('secondary');

    /* ---------------- colors ---------------- */
    function getHeaderColor() {
      if (webAppHeaderColorKey === 'secondary_bg_color') return themeParams.secondary_bg_color;
      if (webAppHeaderColorKey === 'bg_color') return themeParams.bg_color;
      return webAppHeaderColor;
    }
    function setHeaderColor(color) {
      var head_color = null, color_key = null;
      if (color === 'bg_color' || color === 'secondary_bg_color') {
        color_key = color;
      } else {
        head_color = parseColorToHex(color);
        if (!head_color) {
          console.error('[Telegram.WebApp] Header color format is invalid', color);
          throw Error('WebAppHeaderColorInvalid');
        }
      }
      webAppHeaderColorKey = color_key;
      webAppHeaderColor = head_color;
      if (head_color) {
        postEvent('web_app_set_header_color', false, { color: head_color });
      } else {
        postEvent('web_app_set_header_color', false, { color_key: color_key });
      }
    }
    function getBackgroundColor() {
      if (webAppBackgroundColor === 'secondary_bg_color') return themeParams.secondary_bg_color;
      if (webAppBackgroundColor === 'bg_color') return themeParams.bg_color;
      return webAppBackgroundColor;
    }
    function setBackgroundColor(color) {
      var bg_color;
      if (color === 'bg_color' || color === 'secondary_bg_color') {
        webAppBackgroundColor = color;
        bg_color = getBackgroundColor();
      } else {
        bg_color = parseColorToHex(color);
        if (!bg_color) {
          console.error('[Telegram.WebApp] Background color format is invalid', color);
          throw Error('WebAppBackgroundColorInvalid');
        }
        webAppBackgroundColor = bg_color;
      }
      postEvent('web_app_set_background_color', false, { color: bg_color });
    }
    function getBottomBarColor() {
      if (webAppBottomBarColor === 'bottom_bar_bg_color') return themeParams.bottom_bar_bg_color;
      if (webAppBottomBarColor === 'secondary_bg_color') return themeParams.secondary_bg_color;
      if (webAppBottomBarColor === 'bg_color') return themeParams.bg_color;
      return webAppBottomBarColor;
    }
    function setBottomBarColor(color) {
      var resolved;
      if (color === 'bottom_bar_bg_color' || color === 'secondary_bg_color' || color === 'bg_color') {
        webAppBottomBarColor = color;
        resolved = getBottomBarColor();
      } else {
        resolved = parseColorToHex(color);
        if (!resolved) {
          console.error('[Telegram.WebApp] Bottom bar color format is invalid', color);
          throw Error('WebAppBottomBarColorInvalid');
        }
        webAppBottomBarColor = resolved;
      }
      postEvent('web_app_set_bottom_bar_color', false, { color: resolved });
      updateChrome();
    }

    /* ---------------- HapticFeedback ---------------- */
    var HapticFeedback = (function () {
      var hf = {};
      function triggerFeedback(params) {
        if (params.type === 'impact') {
          if (['light', 'medium', 'heavy', 'rigid', 'soft'].indexOf(params.impact_style) === -1) {
            console.error('[Telegram.WebApp] Haptic impact style is invalid', params.impact_style);
            throw Error('WebAppHapticImpactStyleInvalid');
          }
        } else if (params.type === 'notification') {
          if (['error', 'success', 'warning'].indexOf(params.notification_type) === -1) {
            console.error('[Telegram.WebApp] Haptic notification type is invalid', params.notification_type);
            throw Error('WebAppHapticNotificationTypeInvalid');
          }
        } else if (params.type !== 'selection_change') {
          console.error('[Telegram.WebApp] Haptic feedback type is invalid', params.type);
          throw Error('WebAppHapticFeedbackTypeInvalid');
        }
        postEvent('web_app_trigger_haptic_feedback', false, params);
        return hf;
      }
      hf.impactOccurred = function (style) {
        return triggerFeedback({ type: 'impact', impact_style: style });
      };
      hf.notificationOccurred = function (type) {
        return triggerFeedback({ type: 'notification', notification_type: type });
      };
      hf.selectionChanged = function () {
        return triggerFeedback({ type: 'selection_change' });
      };
      return hf;
    })();

    /* ---------------- custom method plumbing (CloudStorage etc.) ---------------- */
    function invokeCustomMethod(method, params, callback) {
      var req_id = generateCallbackId(16);
      webAppCallbacks[req_id] = { callback: callback };
      postEvent('web_app_invoke_custom_method', false, {
        req_id: req_id,
        method: method,
        params: params || {}
      });
      return req_id;
    }

    function resolveCustomMethod(req_id, error, result) {
      // Emulates the client answering web_app_invoke_custom_method: the reply
      // travels the exact official code path (custom_method_invoked wire event).
      setTimeout(function () {
        var payload = { req_id: req_id };
        if (error != null) payload.error = error;
        else payload.result = result;
        receiveEvent('custom_method_invoked', payload);
      }, 0);
    }

    onRawEvent('custom_method_invoked', function (eventType, eventData) {
      if (eventData && eventData.req_id && webAppCallbacks[eventData.req_id]) {
        var requestData = webAppCallbacks[eventData.req_id];
        delete webAppCallbacks[eventData.req_id];
        var res = null, err = null;
        if (typeof eventData.result !== 'undefined') res = eventData.result;
        if (typeof eventData.error !== 'undefined') err = eventData.error;
        if (requestData.callback) {
          try {
            requestData.callback(err, res);
          } catch (e) {
            console.error('[tma-devkit] custom method callback error', e);
          }
        }
      }
    });

    /* ---------------- storage (CloudStorage/DeviceStorage/SecureStorage) ---------------- */
    function localStorageFacade(namespace, methodNames) {
      var PREFIX = 'tma-devkit:' + namespace + ':';
      var facade = {};

      function readAll() {
        var out = {};
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(PREFIX) === 0) {
              out[k.slice(PREFIX.length)] = localStorage.getItem(k);
            }
          }
        } catch (e) {}
        return out;
      }

      function invoke(method, params, callback) {
        // Post the same bridge event the official script would, then resolve
        // locally through the custom_method_invoked path.
        var req_id = invokeCustomMethod(method, params, callback);
        var error = null, result = null;
        try {
          if (method === methodNames.save) {
            localStorage.setItem(PREFIX + params.key, String(params.value));
            result = true;
          } else if (method === methodNames.get) {
            var all = readAll();
            result = {};
            for (var i = 0; i < params.keys.length; i++) {
              var key = params.keys[i];
              if (Object.prototype.hasOwnProperty.call(all, key)) result[key] = all[key];
            }
          } else if (method === methodNames.del) {
            for (var j = 0; j < params.keys.length; j++) {
              localStorage.removeItem(PREFIX + params.keys[j]);
            }
            result = true;
          } else if (method === methodNames.keys) {
            result = Object.keys(readAll());
          } else {
            error = 'ERR_UNKNOWN_METHOD';
          }
        } catch (e) {
          error = 'ERR_STORAGE_UNAVAILABLE';
        }
        resolveCustomMethod(req_id, error, result);
      }

      facade.setItem = function (key, value, callback) {
        invoke(methodNames.save, { key: key, value: value }, callback);
        return facade;
      };
      facade.getItem = function (key, callback) {
        return facade.getItems([key], callback ? function (err, res) {
          if (err) callback(err);
          else callback(null, res[key]);
        } : null);
      };
      facade.getItems = function (keys, callback) {
        invoke(methodNames.get, { keys: keys }, callback);
        return facade;
      };
      facade.removeItem = function (key, callback) {
        return facade.removeItems([key], callback);
      };
      facade.removeItems = function (keys, callback) {
        invoke(methodNames.del, { keys: keys }, callback);
        return facade;
      };
      facade.getKeys = function (callback) {
        invoke(methodNames.keys, {}, callback);
        return facade;
      };
      return facade;
    }

    // Official CloudStorage method names (packages: telegram-web-app.js).
    var CloudStorage = localStorageFacade('cloud', {
      save: 'saveStorageValue',
      get: 'getStorageValues',
      del: 'deleteStorageValues',
      keys: 'getStorageKeys'
    });
    var DeviceStorage = localStorageFacade('device', {
      save: 'deviceStorageSaveKey',
      get: 'deviceStorageGetKey',
      del: 'deviceStorageClearKey',
      keys: 'deviceStorageGetKeys'
    });
    var SecureStorage = localStorageFacade('secure', {
      save: 'secureStorageSaveKey',
      get: 'secureStorageGetKey',
      del: 'secureStorageClearKey',
      keys: 'secureStorageGetKeys'
    });

    /* ---------------- in-app popups (alert/confirm/popup/QR) ---------------- */
    var popupEl = null;

    function closeInAppPopup(button_id) {
      if (!webAppPopupOpened) return;
      var popupData = webAppPopupOpened;
      webAppPopupOpened = false;
      if (popupEl && popupEl.parentNode) popupEl.parentNode.removeChild(popupEl);
      popupEl = null;
      if (popupData.callback) {
        try {
          popupData.callback(button_id);
        } catch (e) {}
      }
      receiveWebViewEvent('popupClosed', { button_id: button_id });
    }

    function renderInAppPopup(params, callback) {
      ensureChrome();
      var overlay = document.createElement('div');
      overlay.setAttribute('data-tma-devkit-chrome', 'popup');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;' +
        'justify-content:center;background:rgba(0,0,0,0.45);padding:24px;box-sizing:border-box;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;';

      var card = document.createElement('div');
      card.style.cssText =
        'width:100%;max-width:320px;border-radius:14px;overflow:hidden;' +
        'background:' + (themeParams.secondary_bg_color || themeParams.bg_color || '#fff') + ';' +
        'color:' + (themeParams.text_color || '#000') + ';' +
        'box-shadow:0 18px 50px rgba(0,0,0,0.35);';

      var body = document.createElement('div');
      body.style.cssText = 'padding:20px 16px 16px;text-align:center;';
      if (params.title) {
        var title = document.createElement('div');
        title.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:8px;';
        title.textContent = params.title;
        body.appendChild(title);
      }
      var msg = document.createElement('div');
      msg.style.cssText = 'font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word;' +
        'color:' + (themeParams.subtitle_text_color || themeParams.hint_color || '#888') + ';';
      msg.textContent = params.message;
      body.appendChild(msg);
      card.appendChild(body);

      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;border-top:0.5px solid ' +
        (themeParams.section_separator_color || 'rgba(128,128,128,0.35)') + ';';
      params.buttons.forEach(function (b, idx) {
        var btn = document.createElement('button');
        var label = b.text ||
          (b.type === 'ok' ? 'OK' : b.type === 'cancel' ? 'Cancel' : b.type === 'close' ? 'Close' : b.id || 'OK');
        btn.textContent = label;
        btn.style.cssText =
          'flex:1;padding:12px 8px;border:none;background:transparent;cursor:pointer;' +
          'font-size:15px;font-family:inherit;' +
          (idx > 0 ? 'border-left:0.5px solid ' + (themeParams.section_separator_color || 'rgba(128,128,128,0.35)') + ';' : '') +
          (b.type === 'destructive'
            ? 'color:' + (themeParams.destructive_text_color || '#d33') + ';font-weight:600;'
            : 'color:' + (themeParams.link_color || '#2481cc') + ';' +
              (b.type === 'ok' || b.type === 'default' ? 'font-weight:600;' : 'font-weight:400;'));
        btn.addEventListener('click', function () {
          closeInAppPopup(b.id || '');
        });
        btnRow.appendChild(btn);
      });
      card.appendChild(btnRow);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      popupEl = overlay;
    }

    /* ---------------- scan QR popup ---------------- */
    var qrPopupEl = null;
    function closeInAppQrPopup(notify) {
      if (!webAppScanQrPopupOpened) return;
      webAppScanQrPopupOpened = false;
      if (qrPopupEl && qrPopupEl.parentNode) qrPopupEl.parentNode.removeChild(qrPopupEl);
      qrPopupEl = null;
      if (notify) receiveWebViewEvent('scanQrPopupClosed');
    }

    function renderInAppQrPopup(params, callback) {
      ensureChrome();
      var overlay = document.createElement('div');
      overlay.setAttribute('data-tma-devkit-chrome', 'qr-popup');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;' +
        'justify-content:center;background:rgba(0,0,0,0.75);padding:24px;box-sizing:border-box;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;';
      var card = document.createElement('div');
      card.style.cssText =
        'width:100%;max-width:320px;border-radius:14px;padding:20px 16px;text-align:center;' +
        'background:' + (themeParams.secondary_bg_color || themeParams.bg_color || '#fff') + ';' +
        'color:' + (themeParams.text_color || '#000') + ';';
      var heading = document.createElement('div');
      heading.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:4px;';
      heading.textContent = 'Scan QR';
      card.appendChild(heading);
      if (params.text) {
        var sub = document.createElement('div');
        sub.style.cssText = 'font-size:13px;margin-bottom:12px;color:' +
          (themeParams.hint_color || '#888') + ';';
        sub.textContent = params.text;
        card.appendChild(sub);
      }
      var hint = document.createElement('div');
      hint.style.cssText = 'font-size:12px;margin:8px 0;color:' + (themeParams.hint_color || '#888') + ';';
      hint.textContent = 'DevKit: paste QR text to simulate a scan';
      card.appendChild(hint);
      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'QR payload…';
      input.style.cssText =
        'width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:10px;border-radius:8px;' +
        'border:1px solid ' + (themeParams.section_separator_color || '#888') + ';' +
        'background:' + (themeParams.bg_color || '#fff') + ';color:' + (themeParams.text_color || '#000') + ';';
      card.appendChild(input);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;';
      var simulate = document.createElement('button');
      simulate.textContent = 'Simulate scan';
      simulate.style.cssText =
        'flex:1;padding:10px;border:none;border-radius:8px;cursor:pointer;font-weight:600;' +
        'background:' + (themeParams.button_color || '#2481cc') + ';color:' +
        (themeParams.button_text_color || '#fff') + ';';
      simulate.addEventListener('click', function () {
        var text = input.value;
        if (!text) return;
        receiveWebViewEvent('qrTextReceived', { data: text });
        var shouldClose = false;
        if (webAppScanQrPopupOpened && webAppScanQrPopupOpened.callback) {
          try {
            shouldClose = webAppScanQrPopupOpened.callback(text) === true;
          } catch (e) {}
        }
        if (shouldClose) closeInAppQrPopup(false);
      });
      var cancel = document.createElement('button');
      cancel.textContent = 'Close';
      cancel.style.cssText =
        'flex:1;padding:10px;border:none;border-radius:8px;cursor:pointer;' +
        'background:' + (themeParams.secondary_bg_color || '#eee') + ';color:' +
        (themeParams.link_color || '#2481cc') + ';';
      cancel.addEventListener('click', function () {
        closeInAppQrPopup(true);
      });
      row.appendChild(simulate);
      row.appendChild(cancel);
      card.appendChild(row);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      qrPopupEl = overlay;
    }

    /* ---------------- the WebApp object ---------------- */
    var WebApp = {};
    var webAppInitData = env.initDataRaw;
    var webAppInitDataUnsafe = env.initDataUnsafe;

    function ro(name, get) {
      Object.defineProperty(WebApp, name, { get: get, enumerable: true });
    }
    ro('initData', function () { return webAppInitData; });
    ro('initDataUnsafe', function () { return webAppInitDataUnsafe; });
    ro('version', function () { return webAppVersion; });
    ro('platform', function () { return webAppPlatform; });
    ro('colorScheme', function () { return colorScheme; });
    ro('themeParams', function () { return themeParams; });
    ro('isActive', function () { return webAppIsActive; });
    ro('isExpanded', function () { return isExpanded; });
    ro('viewportHeight', function () { return currentViewportHeight(); });
    ro('viewportStableHeight', function () { return currentViewportStableHeight(); });
    ro('safeAreaInset', function () { return safeAreaInset; });
    ro('contentSafeAreaInset', function () { return contentSafeAreaInset; });
    ro('isClosingConfirmationEnabled', function () { return isClosingConfirmationEnabled; });
    ro('isVerticalSwipesEnabled', function () { return isVerticalSwipesEnabled; });
    ro('isFullscreen', function () { return webAppIsFullscreen; });
    ro('isOrientationLocked', function () { return webAppIsOrientationLocked; });
    ro('headerColor', function () { return getHeaderColor(); });
    ro('backgroundColor', function () { return getBackgroundColor(); });
    ro('bottomBarColor', function () { return getBottomBarColor(); });

    Object.defineProperty(WebApp, 'BackButton', { value: BackButton, enumerable: true });
    Object.defineProperty(WebApp, 'MainButton', { value: MainButton, enumerable: true });
    Object.defineProperty(WebApp, 'SecondaryButton', { value: SecondaryButton, enumerable: true });
    Object.defineProperty(WebApp, 'SettingsButton', { value: SettingsButton, enumerable: true });
    Object.defineProperty(WebApp, 'HapticFeedback', { value: HapticFeedback, enumerable: true });
    Object.defineProperty(WebApp, 'CloudStorage', { value: CloudStorage, enumerable: true });
    Object.defineProperty(WebApp, 'DeviceStorage', { value: DeviceStorage, enumerable: true });
    Object.defineProperty(WebApp, 'SecureStorage', { value: SecureStorage, enumerable: true });

    // Inert sensor/biometry stubs: methods exist and post the official bridge
    // events (visible in the inspector), then report failure/unavailable.
    function stubSensor(name, startEvent, stopEvent, failedEventName) {
      var obj = { isStarted: false };
      obj.start = function (params, callback) {
        postEvent(startEvent, false, params || {});
        obj.isStarted = false;
        if (callback) setTimeout(function () { callback(false); }, 0);
        setTimeout(function () {
          receiveWebViewEvent(failedEventName, { error: 'ERR_SENSOR_NOT_AVAILABLE_IN_DEVKIT' });
        }, 0);
        return obj;
      };
      obj.stop = function (callback) {
        postEvent(stopEvent);
        obj.isStarted = false;
        if (callback) setTimeout(function () { callback(true); }, 0);
        return obj;
      };
      return obj;
    }
    Object.defineProperty(WebApp, 'Accelerometer', {
      value: stubSensor('Accelerometer', 'web_app_start_accelerometer', 'web_app_stop_accelerometer', 'accelerometerFailed'),
      enumerable: true
    });
    Object.defineProperty(WebApp, 'DeviceOrientation', {
      value: stubSensor('DeviceOrientation', 'web_app_start_device_orientation', 'web_app_stop_device_orientation', 'deviceOrientationFailed'),
      enumerable: true
    });
    Object.defineProperty(WebApp, 'Gyroscope', {
      value: stubSensor('Gyroscope', 'web_app_start_gyroscope', 'web_app_stop_gyroscope', 'gyroscopeFailed'),
      enumerable: true
    });
    var BiometricManager = {
      isInited: true,
      isBiometricAvailable: false,
      biometricType: 'unknown',
      isAccessRequested: false,
      isAccessGranted: false,
      isBiometricTokenSaved: false,
      deviceId: '',
      init: function (callback) {
        postEvent('web_app_biometry_get_info');
        if (callback) setTimeout(callback, 0);
      },
      requestAccess: function (params, callback) {
        postEvent('web_app_biometry_request_access', false, params || {});
        if (callback) setTimeout(function () { callback(false); }, 0);
      },
      authenticate: function (params, callback) {
        postEvent('web_app_biometry_request_auth', false, params || {});
        if (callback) setTimeout(function () { callback(false, null); }, 0);
      },
      updateBiometricToken: function (token, callback) {
        postEvent('web_app_biometry_update_token', false, { token: token });
        if (callback) setTimeout(function () { callback(false); }, 0);
      },
      openSettings: function () {
        postEvent('web_app_biometry_open_settings');
      }
    };
    Object.defineProperty(WebApp, 'BiometricManager', { value: BiometricManager, enumerable: true });
    var LocationManager = {
      isInited: true,
      isLocationAvailable: false,
      isAccessRequested: false,
      isAccessGranted: false,
      init: function (callback) {
        postEvent('web_app_check_location');
        if (callback) setTimeout(callback, 0);
      },
      getLocation: function (callback) {
        postEvent('web_app_request_location');
        if (callback) setTimeout(function () { callback(null); }, 0);
      },
      openSettings: function () {
        postEvent('web_app_open_location_settings');
      }
    };
    Object.defineProperty(WebApp, 'LocationManager', { value: LocationManager, enumerable: true });

    /* ---------------- WebApp methods ---------------- */
    WebApp.isVersionAtLeast = function (ver) { return versionAtLeast(ver); };
    WebApp.setHeaderColor = function (color) { setHeaderColor(color); };
    WebApp.setBackgroundColor = function (color) { setBackgroundColor(color); };
    WebApp.setBottomBarColor = function (color) { setBottomBarColor(color); };
    WebApp.enableClosingConfirmation = function () {
      isClosingConfirmationEnabled = true;
      postEvent('web_app_setup_closing_behavior', false, { need_confirmation: true });
    };
    WebApp.disableClosingConfirmation = function () {
      isClosingConfirmationEnabled = false;
      postEvent('web_app_setup_closing_behavior', false, { need_confirmation: false });
    };
    WebApp.enableVerticalSwipes = function () {
      isVerticalSwipesEnabled = true;
      postEvent('web_app_setup_swipe_behavior', false, { allow_vertical_swipe: true });
    };
    WebApp.disableVerticalSwipes = function () {
      isVerticalSwipesEnabled = false;
      postEvent('web_app_setup_swipe_behavior', false, { allow_vertical_swipe: false });
    };
    WebApp.lockOrientation = function () {
      webAppIsOrientationLocked = true;
      postEvent('web_app_toggle_orientation_lock', false, { locked: true });
    };
    WebApp.unlockOrientation = function () {
      webAppIsOrientationLocked = false;
      postEvent('web_app_toggle_orientation_lock', false, { locked: false });
    };
    WebApp.requestFullscreen = function () {
      postEvent('web_app_request_fullscreen');
      webAppIsFullscreen = true;
      receiveWebViewEvent('fullscreenChanged');
    };
    WebApp.exitFullscreen = function () {
      postEvent('web_app_exit_fullscreen');
      webAppIsFullscreen = false;
      receiveWebViewEvent('fullscreenChanged');
    };
    WebApp.addToHomeScreen = function () {
      postEvent('web_app_add_to_home_screen');
    };
    WebApp.checkHomeScreenStatus = function (callback) {
      postEvent('web_app_check_home_screen');
      var status = 'unknown';
      receiveWebViewEvent('homeScreenChecked', { status: status });
      if (callback) setTimeout(function () { callback(status); }, 0);
    };
    WebApp.onEvent = function (eventType, callback) { onWebViewEvent(eventType, callback); };
    WebApp.offEvent = function (eventType, callback) { offWebViewEvent(eventType, callback); };
    WebApp.sendData = function (data) {
      if (!data || !data.length) {
        console.error('[Telegram.WebApp] Data is required', data);
        throw Error('WebAppDataInvalid');
      }
      if (byteLength(data) > 4096) {
        console.error('[Telegram.WebApp] Data is too long', data);
        throw Error('WebAppDataInvalid');
      }
      postEvent('web_app_data_send', false, { data: data });
    };
    WebApp.switchInlineQuery = function (query, choose_chat_types) {
      query = query || '';
      if (query.length > 256) {
        console.error('[Telegram.WebApp] Inline query is too long', query);
        throw Error('WebAppInlineQueryInvalid');
      }
      var chat_types = [];
      if (choose_chat_types) {
        if (!Array.isArray(choose_chat_types)) {
          console.error('[Telegram.WebApp] Choose chat types should be an array', choose_chat_types);
          throw Error('WebAppInlineChooseChatTypesInvalid');
        }
        var good = { users: 1, bots: 1, groups: 1, channels: 1 };
        for (var i = 0; i < choose_chat_types.length; i++) {
          var t = choose_chat_types[i];
          if (!good[t]) {
            console.error('[Telegram.WebApp] Choose chat type is invalid', t);
            throw Error('WebAppInlineChooseChatTypeInvalid');
          }
          if (good[t] !== 2) {
            good[t] = 2;
            chat_types.push(t);
          }
        }
      }
      postEvent('web_app_switch_inline_query', false, { query: query, chat_types: chat_types });
    };
    WebApp.openLink = function (url, options) {
      var a = document.createElement('a');
      a.href = url;
      if (a.protocol !== 'http:' && a.protocol !== 'https:') {
        console.error('[Telegram.WebApp] Url protocol is not supported', url);
        throw Error('WebAppTgUrlInvalid');
      }
      options = options || {};
      var req_params = { url: a.href };
      if (options.try_instant_view) req_params.try_instant_view = true;
      if (options.try_browser) req_params.try_browser = options.try_browser;
      postEvent('web_app_open_link', false, req_params);
    };
    WebApp.openTelegramLink = function (url, options) {
      var a = document.createElement('a');
      a.href = url;
      if (a.protocol !== 'http:' && a.protocol !== 'https:') {
        console.error('[Telegram.WebApp] Url protocol is not supported', url);
        throw Error('WebAppTgUrlInvalid');
      }
      var host = a.hostname.toLowerCase();
      if (host !== 't.me' && host !== 'telegram.me') {
        console.error('[Telegram.WebApp] Url host is not supported', url);
        throw Error('WebAppTgUrlInvalid');
      }
      options = options || {};
      var req_params = { path_full: a.pathname + a.search };
      if (options.force_request) req_params.force_request = true;
      postEvent('web_app_open_tg_link', false, req_params);
    };
    WebApp.openInvoice = function (url, callback) {
      var a = document.createElement('a'), match, slug;
      a.href = url;
      if ((a.protocol !== 'http:' && a.protocol !== 'https:') ||
          (a.hostname.toLowerCase() !== 't.me' && a.hostname.toLowerCase() !== 'telegram.me') ||
          !(match = a.pathname.match(/^\/(\$|invoice\/)([A-Za-z0-9\-_=]+)$/)) ||
          !(slug = match[2])) {
        console.error('[Telegram.WebApp] Invoice url is invalid', url);
        throw Error('WebAppInvoiceUrlInvalid');
      }
      if (webAppInvoices[slug]) {
        console.error('[Telegram.WebApp] Invoice is already opened');
        throw Error('WebAppInvoiceOpened');
      }
      webAppInvoices[slug] = { url: url, callback: callback };
      postEvent('web_app_open_invoice', false, { slug: slug });
    };
    WebApp.showPopup = function (params, callback) {
      if (webAppPopupOpened) {
        console.error('[Telegram.WebApp] Popup is already opened');
        throw Error('WebAppPopupOpened');
      }
      var popup_params = {};
      var title = strTrim(params.title || '');
      if (title.length > 64) {
        console.error('[Telegram.WebApp] Popup title is too long', title);
        throw Error('WebAppPopupParamInvalid');
      }
      if (title.length > 0) popup_params.title = title;
      var message = strTrim(params.message || '');
      if (!message.length || message.length > 256) {
        console.error('[Telegram.WebApp] Popup message is invalid', message);
        throw Error('WebAppPopupParamInvalid');
      }
      popup_params.message = message;
      var buttons = [];
      if (params.buttons) {
        for (var i = 0; i < params.buttons.length; i++) {
          var button = params.buttons[i];
          var b = {};
          b.id = typeof button.id === 'undefined' ? '' : String(button.id);
          if (b.id.length > 64) {
            console.error('[Telegram.WebApp] Popup button id is too long', b.id);
            throw Error('WebAppPopupParamInvalid');
          }
          var btype = typeof button.type === 'undefined' ? 'default' : button.type;
          b.type = btype;
          if (btype === 'default' || btype === 'destructive') {
            var text = strTrim(button.text || '');
            if (!text.length || text.length > 64) {
              console.error('[Telegram.WebApp] Popup button text is invalid', button.text);
              throw Error('WebAppPopupParamInvalid');
            }
            b.text = text;
          } else if (btype !== 'ok' && btype !== 'close' && btype !== 'cancel') {
            console.error('[Telegram.WebApp] Popup button type is invalid', btype);
            throw Error('WebAppPopupParamInvalid');
          }
          buttons.push(b);
        }
      } else {
        buttons.push({ id: '', type: 'close' });
      }
      if (buttons.length < 1 || buttons.length > 3) {
        console.error('[Telegram.WebApp] Popup should have 1-3 buttons');
        throw Error('WebAppPopupParamInvalid');
      }
      popup_params.buttons = buttons;
      webAppPopupOpened = { callback: callback };
      postEvent('web_app_open_popup', false, popup_params);
      renderInAppPopup(popup_params, callback);
    };
    WebApp.showAlert = function (message, callback) {
      WebApp.showPopup({ message: message }, callback ? function () { callback(); } : null);
    };
    WebApp.showConfirm = function (message, callback) {
      WebApp.showPopup({
        message: message,
        buttons: [
          { type: 'ok', id: 'ok' },
          { type: 'cancel' }
        ]
      }, callback ? function (button_id) { callback(button_id === 'ok'); } : null);
    };
    WebApp.showScanQrPopup = function (params, callback) {
      if (webAppScanQrPopupOpened) {
        console.error('[Telegram.WebApp] Popup is already opened');
        throw Error('WebAppScanQrPopupOpened');
      }
      var popup_params = {};
      if (params && typeof params.text !== 'undefined') {
        var text = strTrim(params.text);
        if (text.length > 64) {
          console.error('[Telegram.WebApp] Scan QR popup text is too long', text);
          throw Error('WebAppScanQrPopupParamInvalid');
        }
        if (text.length > 0) popup_params.text = text;
      }
      webAppScanQrPopupOpened = { callback: callback };
      postEvent('web_app_open_scan_qr_popup', false, popup_params);
      renderInAppQrPopup(popup_params, callback);
    };
    WebApp.closeScanQrPopup = function () {
      postEvent('web_app_close_scan_qr_popup', false);
      closeInAppQrPopup(false);
    };
    WebApp.readTextFromClipboard = function (callback) {
      var req_id = generateCallbackId(16);
      webAppCallbacks[req_id] = { callback: callback };
      postEvent('web_app_read_text_from_clipboard', false, { req_id: req_id });
      function finish(text) {
        setTimeout(function () {
          receiveEvent('clipboard_text_received', { req_id: req_id, data: text });
        }, 0);
      }
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(finish, function () { finish(null); });
      } else {
        finish(null);
      }
    };
    WebApp.requestWriteAccess = function (callback) {
      postEvent('web_app_request_write_access');
      setTimeout(function () {
        receiveEvent('write_access_requested', { status: 'allowed' });
        if (callback) callback(true);
      }, 0);
    };
    WebApp.requestContact = function (callback) {
      postEvent('web_app_request_phone');
      setTimeout(function () {
        receiveEvent('phone_requested', {
          status: 'sent',
          response: urlSafeDecode('contact=%7B%7D')
        });
        if (callback) callback(true);
      }, 0);
    };
    WebApp.shareToStory = function (media_url, params) {
      var share_params = { media_url: media_url };
      if (params) {
        if (params.text) share_params.text = params.text;
        if (params.widget_link) share_params.widget_link = params.widget_link;
      }
      postEvent('web_app_share_to_story', false, share_params);
    };
    WebApp.shareMessage = function (msg_id, callback) {
      postEvent('web_app_send_prepared_message', false, { id: msg_id });
      setTimeout(function () {
        receiveWebViewEvent('shareMessageSent');
        if (callback) callback(true);
      }, 0);
    };
    WebApp.setEmojiStatus = function (custom_emoji_id, params, callback) {
      var p = { custom_emoji_id: custom_emoji_id };
      if (params && params.duration) p.duration = params.duration;
      postEvent('web_app_set_emoji_status', false, p);
      if (callback) setTimeout(function () { callback(true); }, 0);
    };
    WebApp.requestEmojiStatusAccess = function (callback) {
      postEvent('web_app_request_emoji_status_access');
      setTimeout(function () {
        receiveWebViewEvent('emojiStatusAccessRequested', { status: 'allowed' });
        if (callback) callback(true);
      }, 0);
    };
    WebApp.downloadFile = function (params, callback) {
      postEvent('web_app_request_file_download', false, params || {});
      setTimeout(function () {
        receiveWebViewEvent('fileDownloadRequested', { status: 'downloading' });
        if (callback) callback(true);
      }, 0);
    };
    WebApp.hideKeyboard = function () {
      postEvent('web_app_hide_keyboard');
    };
    WebApp.ready = function () {
      postEvent('web_app_ready');
    };
    WebApp.expand = function () {
      postEvent('web_app_expand');
      // The real client answers web_app_expand with viewport_changed; emulate it.
      setViewportHeight({
        height: viewportHeight !== false ? viewportHeight : window.innerHeight,
        is_state_stable: true,
        is_expanded: true
      });
      updateChrome();
    };
    WebApp.close = function (options) {
      options = options || {};
      var req_params = {};
      if (options.return_back) req_params.return_back = true;
      postEvent('web_app_close', false, req_params);
    };

    /* ---------------- inbound wire events (client → app) ---------------- */
    onRawEvent('theme_changed', function (eventType, eventData) {
      if (eventData && eventData.theme_params) {
        setThemeParams(eventData.theme_params);
        if (eventData.theme_params.bg_color) {
          setColorScheme(isColorDark(eventData.theme_params.bg_color) ? 'dark' : 'light');
        }
        MainButton.setParams({});
        SecondaryButton.setParams({});
        updateChrome();
        receiveWebViewEvent('themeChanged');
      }
    });
    onRawEvent('viewport_changed', function (eventType, eventData) {
      if (eventData && eventData.height !== undefined) {
        setViewportHeight(eventData);
      }
    });
    onRawEvent('safe_area_changed', function (e, d) { setSafeAreaInset(d); receiveWebViewEvent('safeAreaChanged'); });
    onRawEvent('content_safe_area_changed', function (e, d) { setContentSafeAreaInset(d); receiveWebViewEvent('contentSafeAreaChanged'); });
    onRawEvent('visibility_changed', function (e, d) {
      if (d && d.is_visible) {
        webAppIsActive = true;
        receiveWebViewEvent('activated');
      } else {
        webAppIsActive = false;
        receiveWebViewEvent('deactivated');
      }
    });
    onRawEvent('invoice_closed', function (e, d) {
      if (d && d.slug && webAppInvoices[d.slug]) {
        var inv = webAppInvoices[d.slug];
        delete webAppInvoices[d.slug];
        if (inv.callback) {
          try { inv.callback(d.status); } catch (err) {}
        }
        receiveWebViewEvent('invoiceClosed', { slug: d.slug, status: d.status });
      }
    });
    onRawEvent('popup_closed', function (e, d) {
      closeInAppPopup(d && typeof d.button_id !== 'undefined' ? d.button_id : null);
    });
    onRawEvent('qr_text_received', function (e, d) {
      receiveWebViewEvent('qrTextReceived', { data: d && d.data });
    });
    onRawEvent('scan_qr_popup_closed', function () { closeInAppQrPopup(false); receiveWebViewEvent('scanQrPopupClosed'); });
    onRawEvent('clipboard_text_received', function (e, d) {
      if (d && d.req_id && webAppCallbacks[d.req_id]) {
        var cb = webAppCallbacks[d.req_id];
        delete webAppCallbacks[d.req_id];
        if (cb.callback) {
          try { cb.callback(d.data || null); } catch (err) {}
        }
      }
      receiveWebViewEvent('clipboardTextReceived', { data: d && d.data });
    });
    onRawEvent('write_access_requested', function (e, d) {
      receiveWebViewEvent('writeAccessRequested', { status: d && d.status });
    });
    onRawEvent('phone_requested', function (e, d) {
      var payload = { status: d && d.status };
      if (d && d.response) {
        payload.response = d.response;
        try { payload.responseUnsafe = {}; } catch (err) {}
      }
      receiveWebViewEvent('contactRequested', payload);
    });
    onRawEvent('file_download_requested', function (e, d) {
      receiveWebViewEvent('fileDownloadRequested', { status: d && d.status });
    });
    onRawEvent('fullscreen_changed', function (e, d) {
      webAppIsFullscreen = !!(d && d.is_fullscreen);
      receiveWebViewEvent('fullscreenChanged');
    });
    onRawEvent('fullscreen_failed', function (e, d) {
      receiveWebViewEvent('fullscreenFailed', { error: d && d.error });
    });
    onRawEvent('home_screen_added', function () { receiveWebViewEvent('homeScreenAdded'); });
    onRawEvent('home_screen_checked', function (e, d) {
      receiveWebViewEvent('homeScreenChecked', { status: d && d.status });
    });
    onRawEvent('main_button_pressed', function () {
      if (MainButton.isActive) receiveWebViewEvent('mainButtonClicked');
    });
    onRawEvent('secondary_button_pressed', function () {
      if (SecondaryButton.isActive) receiveWebViewEvent('secondaryButtonClicked');
    });
    onRawEvent('back_button_pressed', function () {
      receiveWebViewEvent('backButtonClicked');
    });
    onRawEvent('settings_button_pressed', function () {
      receiveWebViewEvent('settingsButtonClicked');
    });
    onRawEvent('reload_iframe', function () {
      postToParent({ eventType: 'iframe_will_reload' });
      location.reload();
    });

    /* ---------------- message listener (postMessage channel) ---------------- */
    window.addEventListener('message', function (event) {
      if (!isIframe() || event.source !== window.parent) return;
      var dataParsed;
      try {
        dataParsed = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (!dataParsed || typeof dataParsed !== 'object') return;

      if (dataParsed.source === SOURCE) {
        // DevKit control channel
        if (dataParsed.type === 'setConfig') {
          applyLiveConfig(dataParsed.config || {}, false);
        } else if (dataParsed.type === 'getState') {
          postToParent({ source: SOURCE, type: 'ack', state: currentMockState() });
        }
        return;
      }
      if (typeof dataParsed.eventType === 'string') {
        if (dataParsed.eventType === 'set_custom_style') return;
        receiveEvent(dataParsed.eventType, dataParsed.eventData);
      }
    });

    function currentMockState() {
      return {
        platform: webAppPlatform,
        version: webAppVersion,
        colorScheme: colorScheme,
        viewportHeight: currentViewportHeight(),
        viewportStableHeight: currentViewportStableHeight(),
        isExpanded: isExpanded,
        themeParams: themeParams
      };
    }

    /* ---------------- install + initial events ---------------- */
    if (!window.Telegram) window.Telegram = {};
    window.Telegram.WebView = WebView;
    window.Telegram.WebViewEvents = {
      onEvent: onWebViewEvent,
      offEvent: offWebViewEvent,
      receiveEvent: receiveWebViewEvent
    };
    window.Telegram.Utils = {
      urlSafeDecode: urlSafeDecode,
      urlParseQueryString: function (queryString) {
        var params = {};
        if (!queryString || !queryString.length) return params;
        var parts = queryString.split('&');
        for (var i = 0; i < parts.length; i++) {
          var kv = parts[i].split('=');
          params[urlSafeDecode(kv[0])] = kv[1] == null ? null : urlSafeDecode(kv[1]);
        }
        return params;
      }
    };
    window.Telegram.WebApp = WebApp;

    setColorScheme(env.colorScheme);
    setThemeParams(env.themeParams);
    if (env.viewportHeight) {
      viewportHeight = env.viewportHeight;
      viewportStableHeight = env.viewportStableHeight || env.viewportHeight;
    }
    setViewportHeight();
    setSafeAreaInset({ top: 0, bottom: 0, left: 0, right: 0 });
    setContentSafeAreaInset({ top: 0, bottom: 0, left: 0, right: 0 });
    if (config.showSettings) SettingsButton.show();

    function announce() {
      postToParent({
        source: SOURCE,
        type: 'hello',
        url: location.href,
        state: currentMockState()
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        updateChrome();
        announce();
      });
    } else {
      updateChrome();
      announce();
    }

    // Official script asks the client for current theme/viewport on load.
    postEvent('web_app_request_theme');
    postEvent('web_app_request_viewport');

    // Cross-check embedded HMAC against Web Crypto, then resolve ready.
    function finalizeReady() {
      log('mock environment active', currentMockState());
      readyResolve(window.Telegram.WebApp);
    }
    try {
      if (window.crypto && crypto.subtle) {
        var enc = new TextEncoder();
        crypto.subtle
          .importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
          .then(function (key) {
            return crypto.subtle.sign('HMAC', key, enc.encode(env.botToken));
          })
          .then(function (secretBuf) {
            return crypto.subtle.importKey('raw', secretBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
          })
          .then(function (secretKey) {
            return crypto.subtle.sign('HMAC', secretKey, enc.encode('DEVKIT_SELFTEST'));
          })
          .then(function (sigBuf) {
            var expected = dkBytesToHex(
              dkHmacSha256Bytes(dkHmacSha256Bytes(dkUtf8Bytes('WebAppData'), dkUtf8Bytes(env.botToken)), dkUtf8Bytes('DEVKIT_SELFTEST'))
            );
            var actual = dkBytesToHex(Array.prototype.slice.call(new Uint8Array(sigBuf)));
            if (expected !== actual) {
              console.error('[tma-devkit] HMAC self-test FAILED — initData hash may be wrong');
            }
            finalizeReady();
          })
          .catch(finalizeReady);
      } else {
        finalizeReady();
      }
    } catch (e) {
      finalizeReady();
    }

    // Debug/introspection handle (used by tests + curious developers).
    window.__tmaDevkit = {
      version: '0.1.0',
      state: currentMockState,
      config: config,
      hmacSha256Hex: function (keyStr, msgStr) {
        return dkBytesToHex(dkHmacSha256Bytes(dkUtf8Bytes(keyStr), dkUtf8Bytes(msgStr)));
      },
      initDataHash: dkTelegramInitDataHash
    };
  }

  /* ======================================================================
   * Live config (postMessage channel)
   * ==================================================================== */

  function applyLiveConfig(config, fromReactivate) {
    if (!config || typeof config !== 'object') return;
    var WebApp = window.Telegram && window.Telegram.WebApp;
    if (!WebApp) {
      if (!activated) activate(config);
      return;
    }
    // Theme + color scheme
    if (config.themeParams || config.colorScheme) {
      var params = {};
      var base = defaultThemeForScheme(config.colorScheme ||
        (WebApp.themeParams.bg_color && isColorDark(WebApp.themeParams.bg_color) ? 'dark' : 'light'));
      for (var k in base) params[k] = base[k];
      if (config.themeParams) {
        for (var tk in config.themeParams) {
          var hex = parseColorToHex(config.themeParams[tk]);
          if (hex) params[tk] = hex;
        }
      }
      // Route through the real wire event so app handlers fire.
      window.Telegram.WebView.receiveEvent('theme_changed', { theme_params: params });
    }
    // Viewport
    if (config.viewport) {
      window.Telegram.WebView.receiveEvent('viewport_changed', {
        height: config.viewport.height,
        is_state_stable: true,
        is_expanded: config.viewport.isExpanded !== false
      });
    }
    postToParent({
      source: SOURCE,
      type: 'ack',
      state: window.__tmaDevkit.state()
    });
  }

  /* ======================================================================
   * Boot
   * ==================================================================== */

  function dormantConfigListener(event) {
    if (!isIframe() || event.source !== window.parent) return;
    var dataParsed;
    try {
      dataParsed = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    if (dataParsed && dataParsed.source === SOURCE && dataParsed.type === 'setConfig') {
      // Hand off to the real activation path, then stop listening — the env's
      // own message listener takes over from here.
      window.removeEventListener('message', dormantConfigListener);
      activate(dataParsed.config || {});
    }
  }

  var initial = readHashConfig();
  if (initial) {
    activate(initial.config);
  } else {
    // Dormant: no config in the URL. Listen for the postMessage channel so
    // the panel can still activate us without a reload.
    window.addEventListener('message', dormantConfigListener);
  }
})();
