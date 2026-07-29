"""
TMA DevKit — server-side initData validator (Python)

Validates Telegram Mini App initData against the official HMAC-SHA-256
specification:
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

Usage:
    from validate_init_data import validate_init_data
    result = validate_init_data(init_data_string, BOT_TOKEN)
    if result['ok']:
        print('User:', result['user'])
    else:
        print('Invalid:', result['error'])
"""

import hmac
import hashlib
import urllib.parse
import json
from typing import Any, Dict, Union


def validate_init_data(init_data: str, bot_token: str) -> Dict[str, Any]:
    """
    Args:
        init_data: raw initData string from WebApp.initData
        bot_token: your bot's token from @BotFather

    Returns:
        {'ok': True, 'user': {...}} or {'ok': False, 'error': '...'}
    """
    if not init_data or not isinstance(init_data, str):
        return {"ok": False, "error": "initData must be a non-empty string"}
    if not bot_token or not isinstance(bot_token, str):
        return {"ok": False, "error": "botToken must be a non-empty string"}

    # Parse query string
    params = dict(urllib.parse.parse_qsl(init_data, keep_blank_values=True))

    received_hash = params.pop("hash", None)
    if not received_hash:
        return {"ok": False, "error": "Missing hash field in initData"}

    # Build data_check_string: keys sorted alphabetically, joined with '\n'
    data_check_string = "\n".join(
        f"{key}={params[key]}" for key in sorted(params.keys())
    )

    # Compute secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
    secret_key = hmac.new(
        key="WebAppData".encode(),
        msg=bot_token.encode(),
        digestmod=hashlib.sha256,
    ).digest()

    # Compute hash = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
    computed_hash = hmac.new(
        key=secret_key,
        msg=data_check_string.encode(),
        digestmod=hashlib.sha256,
    ).hexdigest()

    if computed_hash != received_hash:
        return {"ok": False, "error": "Hash mismatch — initData is invalid or expired"}

    # Return user data for convenience
    user = None
    raw_user = params.get("user")
    if raw_user:
        try:
            user = json.loads(raw_user)
        except json.JSONDecodeError:
            pass  # user field is optional

    return {"ok": True, "user": user}