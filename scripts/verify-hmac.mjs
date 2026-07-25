/**
 * HMAC correctness verification for tma-devkit.js
 *
 * Extracts the pure SHA-256/HMAC block (between DEVKIT-HMAC markers) from
 * public/tma-devkit.js, evaluates it in Node, and cross-checks against
 * node:crypto using the official Telegram initData validation flow:
 *
 *   data_check_string = all fields except `hash`, sorted alphabetically,
 *                       joined as `key=<value>` with '\n'
 *   secret_key        = HMAC_SHA256(key="WebAppData", data=bot_token)
 *   hash              = hex(HMAC_SHA256(key=secret_key, data=data_check_string))
 *
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Run: node scripts/verify-hmac.mjs
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'public', 'tma-devkit.js'), 'utf8');

const m = src.match(/\/\* =+[\s\S]*?DEVKIT-HMAC-BEGIN[\s\S]*?\/\* DEVKIT-HMAC-END \*\//);
if (!m) {
  console.error('FAIL: could not locate DEVKIT-HMAC markers in public/tma-devkit.js');
  process.exit(1);
}

// Evaluate the extracted pure block in an isolated function scope.
const factory = new Function(`${m[0]}
  return { dkUtf8Bytes, dkSha256Bytes, dkHmacSha256Bytes, dkBytesToHex, dkTelegramInitDataHash };
`);
const js = factory();

// ---- reference implementation via node:crypto (the "server-side check") ----
function nodeInitDataHash(dataCheckString, botToken) {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

function buildDataCheckString(fields) {
  return Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
}

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`  js:   ${actual}`);
    console.log(`  node: ${expected}`);
  }
}

// 1) SHA-256 known vectors
check(
  'sha256("abc")',
  js.dkBytesToHex(js.dkSha256Bytes(js.dkUtf8Bytes('abc'))),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
);
check(
  'sha256("")',
  js.dkBytesToHex(js.dkSha256Bytes(js.dkUtf8Bytes(''))),
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
);
const longMsg = 'The quick brown fox jumps over the lazy dog. '.repeat(100) + '€unicode✓';
check(
  'sha256(long+unicode) vs node',
  js.dkBytesToHex(js.dkSha256Bytes(js.dkUtf8Bytes(longMsg))),
  createHash('sha256').update(longMsg, 'utf8').digest('hex'),
);

// 2) HMAC-SHA256 vs node:crypto with random keys/messages
for (let i = 0; i < 5; i++) {
  const key = randomBytes(8 + i * 7).toString('hex');
  const msg = randomBytes(20 + i * 13).toString('base64url');
  check(
    `hmac-sha256 random #${i + 1}`,
    js.dkHmacSha256Hex ?? js.dkBytesToHex(js.dkHmacSha256Bytes(js.dkUtf8Bytes(key), js.dkUtf8Bytes(msg))),
    createHmac('sha256', key).update(msg, 'utf8').digest('hex'),
  );
}

// 3) Full Telegram initData flow, fixed config (deterministic)
const botToken = '123456789:DEVKIT_TEST_TOKEN';
const user = JSON.stringify({
  id: 424242,
  first_name: 'Ada',
  last_name: 'Lovelace',
  username: 'ada_dev',
  language_code: 'en',
  is_premium: true,
});
const fields = {
  auth_date: '1718000000',
  chat_instance: '-9000900090009000',
  chat_type: 'sender',
  query_id: 'AADEVKITQUERYID',
  user,
};
const dcs = buildDataCheckString(fields);
check('telegram initData hash (fixed config)', js.dkTelegramInitDataHash(dcs, botToken), nodeInitDataHash(dcs, botToken));

// 4) Telegram docs pseudocode shape: fields with special chars in JSON
const fields2 = {
  auth_date: '1718000123',
  user: JSON.stringify({ id: 1, first_name: 'Tëst "quoted" Üser\nline', username: 't_u' }),
  start_param: 'ref=abc&x=1',
};
const dcs2 = buildDataCheckString(fields2);
check('telegram initData hash (special chars)', js.dkTelegramInitDataHash(dcs2, botToken), nodeInitDataHash(dcs2, botToken));

console.log(failures === 0 ? '\nAll HMAC checks passed ✔' : `\n${failures} check(s) FAILED ✘`);
process.exit(failures === 0 ? 0 : 1);
