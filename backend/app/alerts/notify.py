"""Alert delivery: in-app (via the live socket), Telegram and email.

Telegram and email work while the browser is closed; configure them in
backend/.env (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID; SMTP_*).
"""

import asyncio
import logging
import smtplib
from email.message import EmailMessage

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)


def available_channels() -> dict[str, bool]:
    s = get_settings()
    return {
        "app": True,
        "telegram": bool(s.telegram_bot_token and s.telegram_chat_id),
        "email": bool(s.smtp_host and s.alert_email_to),
    }


async def telegram(text: str) -> None:
    s = get_settings()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{s.telegram_bot_token}/sendMessage",
            json={"chat_id": s.telegram_chat_id, "text": text, "disable_web_page_preview": True},
        )
        resp.raise_for_status()


def _send_email(subject: str, body: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = s.smtp_from or s.smtp_user
    msg["To"] = s.alert_email_to
    msg.set_content(body)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
        if s.smtp_starttls:
            smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)


async def email(subject: str, body: str) -> None:
    await asyncio.to_thread(_send_email, subject, body)


async def deliver(channels: list[str], title: str, body: str, push_app) -> dict[str, str]:
    """Send to each requested channel; returns {channel: 'ok' | error}."""
    configured = available_channels()
    results: dict[str, str] = {}
    for ch in channels:
        try:
            if ch == "app":
                push_app()
            elif ch == "telegram" and configured["telegram"]:
                await telegram(f"🔔 {title}\n{body}")
            elif ch == "email" and configured["email"]:
                await email(f"Alert: {title}", body)
            else:
                results[ch] = "not configured"
                continue
            results[ch] = "ok"
        except Exception as e:
            log.warning("alert delivery via %s failed: %s", ch, e)
            results[ch] = str(e)[:200]
    return results
