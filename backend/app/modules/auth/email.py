from email.message import EmailMessage
from email.utils import formataddr
from html import escape
import certifi
import smtplib
import ssl
from urllib.parse import quote, urlsplit

from app.core.config import settings


class EmailDeliveryNotConfigured(Exception):
    pass


def verification_link(token: str, base_url: str | None = None) -> str:
    base_url = (base_url or settings.EMAIL_VERIFICATION_BASE_URL).strip()
    parsed = urlsplit(base_url)
    is_local_http = parsed.scheme == "http" and parsed.hostname in {
        "localhost",
        "127.0.0.1",
        "::1",
    }
    if (
        (parsed.scheme != "https" and not is_local_http)
        or not parsed.netloc
        or parsed.username
        or parsed.password
    ):
        raise EmailDeliveryNotConfigured
    if parsed.query or parsed.fragment:
        raise EmailDeliveryNotConfigured
    # Fragments are not sent in HTTP requests or written to API access logs.
    return f"{base_url}#token={quote(token, safe='')}"


def _send_email(recipient: str, subject: str, text_body: str, html_body: str) -> None:
    if not settings.smtp_configured:
        raise EmailDeliveryNotConfigured
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.SMTP_FROM_NAME.strip(), settings.SMTP_FROM_EMAIL.strip()))
    message["To"] = recipient
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    # Some Python distributions (notably the python.org macOS build) ship with
    # an empty or stale OpenSSL CA directory. Use certifi's maintained roots so
    # Gmail's STARTTLS certificate is verified consistently across platforms.
    context = ssl.create_default_context(cafile=certifi.where())
    if settings.SMTP_USE_SSL:
        with smtplib.SMTP_SSL(
            settings.SMTP_HOST.strip(), settings.SMTP_PORT, context=context, timeout=20
        ) as server:
            if settings.SMTP_USERNAME.strip():
                server.login(settings.SMTP_USERNAME.strip(), settings.SMTP_PASSWORD)
            server.send_message(message)
    else:
        with smtplib.SMTP(settings.SMTP_HOST.strip(), settings.SMTP_PORT, timeout=20) as server:
            server.ehlo()
            if settings.SMTP_STARTTLS:
                server.starttls(context=context)
                server.ehlo()
            if settings.SMTP_USERNAME.strip():
                server.login(settings.SMTP_USERNAME.strip(), settings.SMTP_PASSWORD)
            server.send_message(message)


def send_verification_email(recipient: str, token: str) -> None:
    link = verification_link(token)
    expiry = f"{settings.EMAIL_VERIFICATION_TOKEN_MINUTES} minutes"
    _send_email(
        recipient,
        "Verify your ShopFlow email",
        "Verify your ShopFlow email address by opening this link:\n\n"
        f"{link}\n\nThis link expires in {expiry} and can only be used once.",
        "<p>Verify your ShopFlow email address:</p>"
        f'<p><a href="{escape(link, quote=True)}">Verify email address</a></p>'
        f"<p>This link expires in {escape(expiry)} and can only be used once.</p>",
    )


def send_password_reset_email(recipient: str, token: str) -> None:
    if not settings.password_reset_delivery_configured:
        raise EmailDeliveryNotConfigured
    link = verification_link(token, settings.PASSWORD_RESET_BASE_URL)
    expiry = f"{settings.PASSWORD_RESET_TOKEN_MINUTES} minutes"
    _send_email(
        recipient,
        "Reset your ShopFlow password",
        "Reset your ShopFlow password by opening this link:\n\n"
        f"{link}\n\nThis link expires in {expiry} and can only be used once.",
        "<p>Reset your ShopFlow password:</p>"
        f'<p><a href="{escape(link, quote=True)}">Reset password</a></p>'
        f"<p>This link expires in {escape(expiry)} and can only be used once.</p>",
    )
