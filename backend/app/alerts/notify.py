"""Alert delivery: in-app (via the live socket), Telegram and email.

Telegram and email work while the browser is closed. The server provides
the Telegram bot (TELEGRAM_BOT_TOKEN) and the mail server (SMTP_*); each
user sets their own Telegram chat id and email in their profile. The
.env TELEGRAM_CHAT_ID / ALERT_EMAIL_TO are fallbacks for admins.
"""

import asyncio
import logging
import smtplib
from email.message import EmailMessage

import httpx

from app.config import get_settings
from app.services import accounts

log = logging.getLogger(__name__)


def recipients(owner: str | None) -> tuple[str | None, str | None]:
    """(telegram chat id, email) for a user, with the .env values as an admin fallback."""
    s = get_settings()
    user = accounts.get_user(owner) if owner else None
    admin = bool(user and user["role"] == "admin") or owner is None
    chat = (user or {}).get("telegram_chat_id") or (s.telegram_chat_id if admin else None)
    email_to = (user or {}).get("email") or (s.alert_email_to if admin else None)
    return chat or None, email_to or None


def available_channels(owner: str | None = None) -> dict[str, bool]:
    s = get_settings()
    chat, email_to = recipients(owner)
    return {
        "app": True,
        "telegram": bool(s.telegram_bot_token and chat),
        "email": bool(s.smtp_host and email_to),
    }


async def telegram(text: str, chat_id: str) -> None:
    s = get_settings()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{s.telegram_bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
        )
        resp.raise_for_status()


def _send_email(subject: str, body: str, to: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = s.smtp_from or s.smtp_user
    msg["To"] = to
    msg.set_content(body)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
        if s.smtp_starttls:
            smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)


async def email(subject: str, body: str, to: str) -> None:
    await asyncio.to_thread(_send_email, subject, body, to)


async def deliver(channels: list[str], title: str, body: str, push_app, owner: str | None = None) -> dict[str, str]:
    """Send to each requested channel for `owner`; returns {channel: 'ok' | error}."""
    configured = available_channels(owner)
    chat, email_to = recipients(owner)
    results: dict[str, str] = {}
    for ch in channels:
        try:
            if ch == "app":
                push_app()
            elif ch == "telegram" and configured["telegram"]:
                await telegram(f"🔔 {title}\n{body}", chat)
            elif ch == "email" and configured["email"]:
                await email(f"Alert: {title}", body, email_to)
            else:
                results[ch] = "not configured"
                continue
            results[ch] = "ok"
        except Exception as e:
            log.warning("alert delivery via %s failed: %s", ch, e)
            results[ch] = str(e)[:200]
    return results
