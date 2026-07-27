/**
 * Multi-channel notifications: Email (Hostinger SMTP), SMS (Twilio US), WhatsApp, Telegram
 */
import nodemailer from "nodemailer";
import twilio from "twilio";
import prisma from "../db.js";
import { getConfig } from "./configService.js";

export async function notifyUser(userId, { type, title, body }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "User not found" };

  const results = [];

  if (user.notifyEmail !== false && user.email) {
    results.push(await sendEmail(user, { type, title, body }));
  }
  if (user.notifyWhatsapp && (user.whatsappNumber || user.phone)) {
    results.push(await sendWhatsApp(user, { type, title, body }));
  }
  if (user.notifyTelegram && user.telegramChatId) {
    results.push(await sendTelegram(user, { type, title, body }));
  }

  if (results.length === 0 && user.email) {
    results.push(await sendEmail(user, { type, title, body }));
  }

  return { ok: true, results };
}

/** Registration OTP: email + SMS separately */
export async function sendRegistrationOtps(user, { emailCode, phoneCode }) {
  const emailResult = await sendEmail(user, {
    type: "verify",
    title: "Avonix Social — Email verification code",
    body: `Your email verification code is: ${emailCode}\n\nValid for 10 minutes. If you did not request this, ignore this email.`,
  });

  const smsResult = await sendSms(user.phone, {
    type: "verify",
    body: `Avonix Social code: ${phoneCode}. Valid 10 min.`,
    userId: user.id,
  });

  return { email: emailResult, sms: smsResult };
}

async function logNotification(userId, channel, type, title, body, status) {
  return prisma.notificationLog.create({
    data: { userId, channel, type, title, body, status },
  });
}

async function getSmtpTransport() {
  const smtpUrl = await getConfig("SMTP_URL", process.env.SMTP_URL || "");
  const host = await getConfig("SMTP_HOST", process.env.SMTP_HOST || "");
  const port = Number(await getConfig("SMTP_PORT", process.env.SMTP_PORT || "465"));
  const user = await getConfig("SMTP_USER", process.env.SMTP_USER || "");
  const pass = await getConfig("SMTP_PASS", process.env.SMTP_PASS || "");

  if (smtpUrl) {
    return nodemailer.createTransport(smtpUrl);
  }
  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return null;
}

export async function sendEmail(user, { type, title, body }) {
  const from =
    (await getConfig("SMTP_FROM", process.env.SMTP_FROM || "")) ||
    process.env.SMTP_USER ||
    "noreply@avonixsocial.com";

  let status = "demo";
  let error = null;

  const transport = await getSmtpTransport();
  if (transport) {
    try {
      await transport.sendMail({
        from,
        to: user.email,
        subject: title,
        text: body,
        html: `<p style="font-family:sans-serif;font-size:15px;line-height:1.5;color:#111">${body.replace(/\n/g, "<br/>")}</p>`,
      });
      status = "sent";
    } catch (err) {
      status = "failed";
      error = err.message;
      console.error(`[email FAILED→${user.email}]`, err.message);
    }
  } else {
    console.log(`[demo-email→${user.email}] ${title}: ${body}`);
  }

  await logNotification(user.id, "email", type, title, body, status);
  return { channel: "email", status, to: user.email, from, error };
}

/**
 * SMS via SignalWire (default/preferred) or Twilio
 * Set SMS_PROVIDER=signalwire | twilio
 */
export async function sendSms(phone, { type, body, userId }) {
  const provider = (
    (await getConfig("SMS_PROVIDER", process.env.SMS_PROVIDER || "")) ||
    (process.env.SIGNALWIRE_PROJECT_ID ? "signalwire" : "twilio")
  )
    .toLowerCase()
    .trim();

  const to = normalizePhone(phone);
  let status = "demo";
  let error = null;
  let from = "";

  if (!to) {
    error =
      "Invalid phone number. Use country code, e.g. +8801XXXXXXXXX or +1XXXXXXXXXX";
    console.log(`[demo-sms→${phone}] ${body}`);
    if (userId) await logNotification(userId, "sms", type, "SMS", body, status);
    return { channel: "sms", status, to: null, from, error, provider };
  }

  try {
    if (provider === "signalwire") {
      const result = await sendViaSignalWire(to, body);
      status = result.status;
      from = result.from;
      error = result.error;
    } else {
      const result = await sendViaTwilio(to, body);
      status = result.status;
      from = result.from;
      error = result.error;
    }
  } catch (err) {
    status = "failed";
    error = err.message;
    console.error(`[sms FAILED→${to}]`, err.message);
  }

  if (status === "demo") {
    console.log(`[demo-sms/${provider}→${to}] ${body}`);
  }

  if (userId) {
    await logNotification(userId, "sms", type, "SMS", body, status);
  }
  return { channel: "sms", status, to, from, error, provider };
}

async function sendViaSignalWire(to, body) {
  const projectId =
    (await getConfig("SIGNALWIRE_PROJECT_ID", process.env.SIGNALWIRE_PROJECT_ID || "")) ||
    process.env.SIGNALWIRE_PROJECT ||
    "";
  const apiToken = await getConfig(
    "SIGNALWIRE_API_TOKEN",
    process.env.SIGNALWIRE_API_TOKEN || ""
  );
  let space = await getConfig("SIGNALWIRE_SPACE_URL", process.env.SIGNALWIRE_SPACE_URL || "");
  const from =
    (await getConfig("SIGNALWIRE_SMS_FROM", process.env.SIGNALWIRE_SMS_FROM || "")) ||
    (await getConfig("TWILIO_SMS_FROM", process.env.TWILIO_SMS_FROM || ""));

  if (!projectId || !apiToken || !space || !from) {
    return {
      status: "demo",
      from,
      error:
        "SignalWire not configured (SIGNALWIRE_PROJECT_ID / API_TOKEN / SPACE_URL / SMS_FROM)",
    };
  }

  // Accept: avonix.signalwire.com or https://avonix.signalwire.com
  space = space.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const url = `https://${space}/api/laml/2010-04-01/Accounts/${encodeURIComponent(projectId)}/Messages.json`;
  const auth = Buffer.from(`${projectId}:${apiToken}`).toString("base64");
  const form = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[signalwire FAILED→${to}]`, res.status, text);
    return { status: "failed", from, error: `SignalWire ${res.status}: ${text.slice(0, 200)}` };
  }

  return { status: "sent", from, error: null };
}

async function sendViaTwilio(to, body) {
  const sid = await getConfig("TWILIO_ACCOUNT_SID", process.env.TWILIO_ACCOUNT_SID || "");
  const token = await getConfig("TWILIO_AUTH_TOKEN", process.env.TWILIO_AUTH_TOKEN || "");
  const from =
    (await getConfig("TWILIO_SMS_FROM", process.env.TWILIO_SMS_FROM || "")) ||
    (await getConfig("TWILIO_PHONE", process.env.TWILIO_PHONE || ""));

  if (!sid || !token || !from) {
    return {
      status: "demo",
      from,
      error: "Twilio not configured (TWILIO_ACCOUNT_SID / AUTH_TOKEN / SMS_FROM)",
    };
  }

  const client = twilio(sid, token);
  await client.messages.create({ from, to, body });
  return { status: "sent", from, error: null };
}

/**
 * Normalize to E.164 for any country.
 * Accepts: +8801712345678, +15551234567, 01712345678 (BD local → +880), 5551234567 (US 10-digit → +1)
 */
export function normalizePhone(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  const digits = raw.replace(/\D/g, "");

  if (!digits || digits.length < 8 || digits.length > 15) return null;

  // Already has + country code
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  // Bangladesh local: 01XXXXXXXXX (11 digits)
  if (digits.length === 11 && digits.startsWith("01")) {
    return `+880${digits.slice(1)}`;
  }
  // Bangladesh without leading 0: 1XXXXXXXXX (10 digits) — ambiguous, treat as BD mobile if starts with 1 and length 10
  // Prefer US for plain 10-digit (common Twilio default)
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  // 11 digits starting with 1 → US
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  // 13 digits starting with 880 → BD
  if (digits.startsWith("880") && digits.length >= 13) {
    return `+${digits}`;
  }

  // Fallback: if looks like country code already (no +)
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

/** @deprecated use normalizePhone — kept for older imports */
export function normalizeUsPhone(phone) {
  return normalizePhone(phone);
}

async function sendWhatsApp(user, { type, title, body }) {
  const toRaw = user.whatsappNumber || user.phone;
  const to = normalizePhone(toRaw);
  const twilioSid = await getConfig("TWILIO_ACCOUNT_SID", process.env.TWILIO_ACCOUNT_SID || "");
  const twilioToken = await getConfig("TWILIO_AUTH_TOKEN", process.env.TWILIO_AUTH_TOKEN || "");
  const from = await getConfig("TWILIO_WHATSAPP_FROM", process.env.TWILIO_WHATSAPP_FROM || "");

  let status = "demo";
  if (twilioSid && twilioToken && from && to) {
    try {
      const client = twilio(twilioSid, twilioToken);
      const waTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
      const waFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
      await client.messages.create({ from: waFrom, to: waTo, body: `${title}\n\n${body}` });
      status = "sent";
    } catch (err) {
      status = "failed";
      console.error("WhatsApp send failed:", err.message);
    }
  } else {
    console.log(`[demo-whatsapp→${to || toRaw}] ${title}: ${body}`);
  }

  await logNotification(user.id, "whatsapp", type, title, body, status);
  return { channel: "whatsapp", status, to };
}

async function sendTelegram(user, { type, title, body }) {
  const token = await getConfig("TELEGRAM_BOT_TOKEN", process.env.TELEGRAM_BOT_TOKEN || "");
  const chatId = user.telegramChatId;

  let status = "demo";
  if (token && chatId) {
    try {
      const text = `*${title}*\n\n${body}`;
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      });
      status = res.ok ? "sent" : "failed";
    } catch (err) {
      status = "failed";
      console.error("Telegram send failed:", err.message);
    }
  } else {
    console.log(`[demo-telegram→${chatId || "unset"}] ${title}: ${body}`);
  }

  await logNotification(user.id, "telegram", type, title, body, status);
  return { channel: "telegram", status, to: chatId };
}

export async function notifyLowBalance(userId, balance) {
  return notifyUser(userId, {
    type: "low_balance",
    title: "Wallet balance low",
    body: `Your Avonix Social wallet balance is $${balance.toFixed(2)}. Top up to keep your plan active.`,
  });
}

export async function notifyFrozen(userId, reason) {
  return notifyUser(userId, {
    type: "frozen",
    title: "Subscription frozen",
    body: `Your subscription has been frozen: ${reason}. Top up your wallet to reactivate.`,
  });
}

export async function notifyMissedPost(userId, hours) {
  return notifyUser(userId, {
    type: "missed_post",
    title: "Reminder: Social / GBP post overdue",
    body: `You have not published a social or GBP post in ${hours}+ hours. Log in to Avonix Social and schedule a post.`,
  });
}

export async function notifyMissedReview(userId, pending) {
  return notifyUser(userId, {
    type: "missed_review",
    title: "Reminder: Google Business reviews need replies",
    body: pending
      ? `You have ${pending} pending Google Business review(s) without a reply.`
      : "It has been a while since your last Google Business review reply. Check your dashboard.",
  });
}
