/**
 * Tests for the Node.js initData validator.
 * Generates real HMAC-signed initData using node:crypto and validates it.
 */

const { validateInitData } = require('./validate-init-data');
const crypto = require('crypto');

function signInitData(fields, botToken) {
  // Sort keys alphabetically
  const sorted = Object.keys(fields).sort();
  const dataCheckString = sorted.map(k => `${k}=${fields[k]}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Build query string
  const parts = sorted.map(k => `${k}=${encodeURIComponent(fields[k])}`);
  parts.push(`hash=${hash}`);
  return parts.join('&');
}

const BOT_TOKEN = '123456789:DEVKIT_TEST_TOKEN';

// ---- Tests ----
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

console.log('Node.js initData validator tests\n');

test('valid initData passes validation', () => {
  const initData = signInitData({
    auth_date: '1720000000',
    user: JSON.stringify({ id: 424242, first_name: 'Ada' }),
    query_id: 'test-query-id',
  }, BOT_TOKEN);

  const result = validateInitData(initData, BOT_TOKEN);
  assert(result.ok === true, `Expected ok=true, got ${JSON.stringify(result)}`);
  assert(result.user.first_name === 'Ada', `Expected user 'Ada', got ${result.user?.first_name}`);
});

test('valid initData with multiple fields', () => {
  const initData = signInitData({
    auth_date: '1720000000',
    user: JSON.stringify({ id: 42, first_name: 'Test', is_premium: true }),
    query_id: 'AAQkAgAAAAA',
    start_param: 'ref123',
    chat_instance: '4242424242',
  }, BOT_TOKEN);

  const result = validateInitData(initData, BOT_TOKEN);
  assert(result.ok === true, `Expected ok=true, got ${JSON.stringify(result)}`);
  assert(result.user.is_premium === true, 'Expected premium user');
});

test('rejects tampered hash', () => {
  const initData = signInitData({
    auth_date: '1720000000',
    user: JSON.stringify({ id: 1, first_name: 'Hacked' }),
  }, BOT_TOKEN);

  // Replace hash with wrong value
  const tampered = initData.replace(/hash=[a-f0-9]+/, 'hash=00000000000000000000000000000000');
  const result = validateInitData(tampered, BOT_TOKEN);
  assert(result.ok === false, 'Expected ok=false for tampered hash');
  assert(result.error.includes('Hash mismatch'), `Expected hash mismatch, got: ${result.error}`);
});

test('rejects missing hash', () => {
  const result = validateInitData('auth_date=1720000000&user=%7B%7D', BOT_TOKEN);
  assert(result.ok === false, 'Expected ok=false for missing hash');
  assert(result.error.includes('Missing hash'), `Expected missing hash error, got: ${result.error}`);
});

test('rejects empty initData', () => {
  const result = validateInitData('', BOT_TOKEN);
  assert(result.ok === false, 'Expected ok=false for empty initData');
});

test('rejects null initData', () => {
  const result = validateInitData(null, BOT_TOKEN);
  assert(result.ok === false, 'Expected ok=false for null initData');
});

test('rejects different bot token', () => {
  const initData = signInitData({
    auth_date: '1720000000',
    user: JSON.stringify({ id: 1, first_name: 'User' }),
  }, BOT_TOKEN);

  const result = validateInitData(initData, '000000000:WRONG_TOKEN');
  assert(result.ok === false, 'Expected ok=false for wrong bot token');
  assert(result.error.includes('Hash mismatch'), `Expected hash mismatch, got: ${result.error}`);
});

test('works without user field (chat init)', () => {
  const initData = signInitData({
    auth_date: '1720000000',
    query_id: 'test-query',
    chat_instance: '777',
    chat_type: 'group',
  }, BOT_TOKEN);

  const result = validateInitData(initData, BOT_TOKEN);
  assert(result.ok === true, `Expected ok=true, got ${JSON.stringify(result)}`);
  assert(result.user === null, `Expected user=null for chat init, got ${result.user}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);