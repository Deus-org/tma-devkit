/**
 * TMA DevKit — server-side initData validator (Node.js)
 * 
 * Validates Telegram Mini App initData against the official HMAC-SHA-256
 * specification:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * 
 * Usage:
 *   const { validateInitData } = require('./validate-init-data');
 *   const result = validateInitData(initDataString, process.env.BOT_TOKEN);
 *   if (result.ok) console.log('User:', result.user);
 *   else console.error('Invalid:', result.error);
 */

const crypto = require('crypto');

/**
 * @param {string} initData — raw initData string from WebApp.initData
 * @param {string} botToken — your bot's token from @BotFather
 * @returns {{ ok: true, user: object } | { ok: false, error: string }}
 */
function validateInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string') {
    return { ok: false, error: 'initData must be a non-empty string' };
  }
  if (!botToken || typeof botToken !== 'string') {
    return { ok: false, error: 'botToken must be a non-empty string' };
  }

  // Parse query string
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    return { ok: false, error: 'Missing hash field in initData' };
  }
  params.delete('hash');

  // Build data_check_string: keys sorted alphabetically, joined with '\n'
  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys.map(key => `${key}=${params.get(key)}`).join('\n');

  // Compute secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // Compute hash = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) {
    return { ok: false, error: 'Hash mismatch — initData is invalid or expired' };
  }

  // Return user data for convenience
  let user = null;
  try {
    const rawUser = params.get('user');
    if (rawUser) user = JSON.parse(rawUser);
  } catch {
    // user field is optional in initData (e.g., chat launches)
  }

  return { ok: true, user };
}

module.exports = { validateInitData };