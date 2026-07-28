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

/** BulkSMSBD OTP text — must match: "Your {Brand} OTP is XXXX" */
function formatOtpSms(phoneCode) {
  const brand =
    process.env.BULKSMSBD_OTP_BRAND ||
    process.env.OTP_SMS_BRAND ||
    "Avonix Social";
  return `Your ${brand} OTP is ${phoneCode}`;
}

/** Registration OTP: email + SMS (BD gateways preferred for +880; WhatsApp fallback) */
export async function sendRegistrationOtps(user, { emailCode, phoneCode }) {
  const emailResult = await sendEmail(user, {
    type: "verify",
    title: "Avonix Social — Email verification code",
    body: `Your email verification code is: ${emailCode}\n\nValid for 10 minutes. If you did not request this, ignore this email.`,
  });

  const smsBody = formatOtpSms(phoneCode);
  const smsResult = await sendSms(user.phone, {
    type: "verify",
    body: smsBody,
    userId: user.id,
  });

  // WhatsApp backup for phone OTP (especially useful for BD when US SMS is blocked)
  let whatsapp = null;
  if (smsResult.status !== "sent") {
    whatsapp = await sendWhatsApp(
      { ...user, whatsappNumber: user.whatsappNumber || user.phone },
      {
        type: "verify",
        title: "Avonix Social verification",
        body: smsBody,
      }
    );
    if (whatsapp.status === "sent") {
      smsResult.status = "sent";
      smsResult.error = smsResult.error
        ? `${smsResult.error} (delivered via WhatsApp)`
        : null;
      smsResult.provider = `${smsResult.provider || "sms"}+whatsapp`;
    }
  }

  return { email: emailResult, sms: smsResult, whatsapp };
}

async function logNotification(userId, channel, type, title, body, status) {
  return prisma.notificationLog.create({
    data: { userId, channel, type, title, body, status },
  });
}

function buildSmtpTransport({ host, port, user, pass }) {
  const secure = port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
}

async function getSmtpCredentials() {
  const smtpUrl = await getConfig("SMTP_URL", process.env.SMTP_URL || "");
  const host = await getConfig("SMTP_HOST", process.env.SMTP_HOST || "");
  const port = Number(await getConfig("SMTP_PORT", process.env.SMTP_PORT || "465"));
  const user = await getConfig("SMTP_USER", process.env.SMTP_USER || "");
  const pass = await getConfig("SMTP_PASS", process.env.SMTP_PASS || "");
  return { smtpUrl, host, port, user, pass };
}

export async function sendEmail(user, { type, title, body }) {
  const from =
    (await getConfig("SMTP_FROM", process.env.SMTP_FROM || "")) ||
    process.env.SMTP_USER ||
    "noreply@avonixsocial.com";

  let status = "demo";
  let error = null;
  let usedHost = "";
  let usedPort = 0;
  let smtpUser = "";

  const { smtpUrl, host, port, user: authUser, pass } = await getSmtpCredentials();
  smtpUser = authUser;

  const attempts = [];
  if (smtpUrl) {
    attempts.push({
      label: "smtpUrl",
      transport: nodemailer.createTransport(smtpUrl),
      host: "smtpUrl",
      port,
    });
  } else if (host && authUser && pass) {
    // Hostinger: try configured port, then 465 / 587 fallback
    const ports = [...new Set([port, 465, 587].filter(Boolean))];
    for (const p of ports) {
      attempts.push({
        label: `${host}:${p}`,
        transport: buildSmtpTransport({ host, port: p, user: authUser, pass }),
        host,
        port: p,
      });
    }
  }

  if (attempts.length === 0) {
    console.log(`[demo-email→${user.email}] ${title}: ${body}`);
    error = "SMTP not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)";
  } else {
    const errors = [];
    for (const attempt of attempts) {
      try {
        await attempt.transport.sendMail({
          from,
          to: user.email,
          subject: title,
          text: body,
          html: `<p style="font-family:sans-serif;font-size:15px;line-height:1.5;color:#111">${body.replace(/\n/g, "<br/>")}</p>`,
        });
        status = "sent";
        usedHost = attempt.host;
        usedPort = attempt.port;
        console.log(`[email SENT→${user.email}] via ${usedHost}:${usedPort} as ${smtpUser}`);
        break;
      } catch (err) {
        errors.push(`${attempt.label}: ${err.message}`);
        console.error(`[email TRY FAILED→${user.email}] ${attempt.label} →`, err.message);
      }
    }
    if (status !== "sent") {
      status = "failed";
      error = errors.join(" | ");
      console.error(`[email FAILED→${user.email}]`, error);
    }
  }

  await logNotification(user.id, "email", type, title, body, status);
  return { channel: "email", status, to: user.email, from, error };
}

/**
 * SMS providers: bulksmsbd | smsnetbd | signalwire | twilio
 * BD (+880) numbers auto-prefer BulkSMSBD / SMS.NET.BD when those keys exist
 * (US SignalWire/Twilio numbers often never deliver to Bangladesh carriers).
 */
export async function sendSms(phone, { type, body, userId }) {
  const to = normalizePhone(phone);
  let status = "demo";
  let error = null;
  let from = "";
  let provider = "none";

  if (!to) {
    error =
      "Invalid phone number. Use country code, e.g. +8801XXXXXXXXX (BD) or +1XXXXXXXXXX (US)";
    console.log(`[demo-sms→${phone}] ${body}`);
    if (userId) await logNotification(userId, "sms", type, "SMS", body, status);
    return { channel: "sms", status, to: null, from, error, provider };
  }

  const configured = (
    (await getConfig("SMS_PROVIDER", process.env.SMS_PROVIDER || "")) ||
    ""
  )
    .toLowerCase()
    .trim();

  const chain = await resolveSmsProviderChain(to, configured);

  try {
    const errors = [];
    for (const p of chain) {
      provider = p;
      let result;
      if (p === "bulksmsbd") result = await sendViaBulkSmsBd(to, body);
      else if (p === "smsnetbd") result = await sendViaSmsNetBd(to, body);
      else if (p === "signalwire") result = await sendViaSignalWire(to, body);
      else if (p === "twilio") result = await sendViaTwilio(to, body);
      else {
        result = { status: "demo", from: "", error: `Unknown SMS provider: ${p}` };
      }

      status = result.status;
      from = result.from || "";
      error = result.error || null;

      if (status === "sent") {
        console.log(`[sms SENT→${to}] via ${p} from=${from || "-"}`);
        break;
      }
      if (error) {
        errors.push(`${p}: ${error}`);
        console.error(`[sms TRY FAILED→${to}] ${p} →`, error);
      }
    }
    if (status !== "sent" && errors.length) {
      error = errors.join(" | ");
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

async function resolveSmsProviderChain(to, configured) {
  const isBd = to.startsWith("+880");
  const hasBulk = !!(
    (await getConfig("BULKSMSBD_API_KEY", process.env.BULKSMSBD_API_KEY || "")) ||
    process.env.BULKSMSBD_API_KEY
  );
  const hasSmsNet = !!(
    (await getConfig("SMSNETBD_API_KEY", process.env.SMSNETBD_API_KEY || "")) ||
    process.env.SMSNETBD_API_KEY
  );
  const hasSw = !!(
    process.env.SIGNALWIRE_PROJECT_ID ||
    (await getConfig("SIGNALWIRE_PROJECT_ID", ""))
  );
  const hasTw = !!(
    process.env.TWILIO_ACCOUNT_SID ||
    (await getConfig("TWILIO_ACCOUNT_SID", ""))
  );

  const chain = [];
  const push = (p) => {
    if (p && !chain.includes(p)) chain.push(p);
  };

  if (configured) push(configured);

  // Bangladesh: local gateways first — US numbers rarely deliver to BD SIMs
  if (isBd) {
    if (hasBulk) push("bulksmsbd");
    if (hasSmsNet) push("smsnetbd");
  }

  if (hasSw) push("signalwire");
  if (hasTw) push("twilio");
  if (!isBd) {
    if (hasBulk) push("bulksmsbd");
    if (hasSmsNet) push("smsnetbd");
  }

  if (chain.length === 0) {
    push(hasSw ? "signalwire" : "twilio");
  }
  return chain;
}

/** BulkSMSBD — https://bulksmsbd.net (recommended for Bangladesh) */
async function sendViaBulkSmsBd(to, body) {
  const apiKey = await getConfig("BULKSMSBD_API_KEY", process.env.BULKSMSBD_API_KEY || "");
  const senderid = (
    await getConfig("BULKSMSBD_SENDER_ID", process.env.BULKSMSBD_SENDER_ID || "")
  ).trim();
  const apiUrl =
    (await getConfig("BULKSMSBD_API_URL", process.env.BULKSMSBD_API_URL || "")) ||
    "https://bulksmsbd.net/api/smsapi";

  if (!apiKey) {
    return {
      status: "demo",
      from: senderid,
      error: "BulkSMSBD not configured (BULKSMSBD_API_KEY missing)",
    };
  }

  if (!senderid) {
    return {
      status: "failed",
      from: "",
      error:
        "BULKSMSBD_SENDER_ID is empty. Register & get Approved Sender ID at bulksmsbd.net → Sender ID Management, then set it in backend/.env (not the API key).",
    };
  }

  // BulkSMSBD expects 8801XXXXXXXXX without + ; official API uses form fields + type=text
  const number = to.replace(/\D/g, "");
  if (apiKey && senderid && apiKey === senderid) {
    return {
      status: "failed",
      from: senderid,
      error:
        "BULKSMSBD_SENDER_ID looks the same as API key. Use your Approved Sender ID from bulksmsbd.net (e.g. 88096… or mask name), not the API key.",
    };
  }

  const form = new URLSearchParams({
    api_key: apiKey,
    type: "text",
    number,
    senderid,
    message: body,
  });

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }

  console.log(`[bulksmsbd response→${number}]`, text.slice(0, 300));

  // ONLY 202 = submitted successfully (do not regex-match "sent" — false positives)
  const code = Number(json?.response_code ?? json?.responseCode);
  const ok = code === 202;

  if (!ok) {
    const hint = json?.error_message || json?.success_message || text.slice(0, 200);
    return {
      status: "failed",
      from: senderid,
      error: `BulkSMSBD response_code=${Number.isFinite(code) ? code : "?"} ${hint}`,
    };
  }
  return { status: "sent", from: senderid, error: null };
}

/** SMS.NET.BD — https://sms.net.bd */
async function sendViaSmsNetBd(to, body) {
  const apiKey = await getConfig("SMSNETBD_API_KEY", process.env.SMSNETBD_API_KEY || "");
  if (!apiKey) {
    return {
      status: "demo",
      from: "",
      error: "SMS.NET.BD not configured (SMSNETBD_API_KEY)",
    };
  }

  const number = to.replace(/\D/g, "");
  const url = new URL("https://api.sms.net.bd/sendsms");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("msg", body);
  url.searchParams.set("to", number);

  const res = await fetch(url.toString(), { method: "GET" });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  const ok = res.ok && (json?.error === 0 || json?.error === "0" || /success/i.test(text));
  if (!ok) {
    return {
      status: "failed",
      from: "",
      error: `SMS.NET.BD ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  return { status: "sent", from: "sms.net.bd", error: null };
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
 * Accepts: +8801712345678, 01712345678, 8801712345678, +15551234567
 * Set SMS_DEFAULT_REGION=BD to treat ambiguous 10-digit 1[3-9]… as Bangladesh mobile.
 */
export function normalizePhone(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  let digits = raw.replace(/\D/g, "");
  const defaultRegion = (
    process.env.SMS_DEFAULT_REGION ||
    process.env.DEFAULT_PHONE_REGION ||
    "BD"
  )
    .toUpperCase()
    .trim();

  if (!digits || digits.length < 8 || digits.length > 15) return null;

  // Mistyped "+01…" — leading 0 is never a valid country code / E.164
  if (digits.startsWith("0") && !digits.startsWith("00")) {
    // BD local must be exactly 01XXXXXXXXX (11 digits)
    if (digits.length === 11 && digits.startsWith("01")) {
      return `+880${digits.slice(1)}`;
    }
    return null;
  }

  if (digits.startsWith("00") && digits.length >= 10) {
    digits = digits.slice(2);
  }

  // +8800… (country + local leading 0)
  if (digits.startsWith("8800") && digits.length >= 14) {
    return `+880${digits.slice(4)}`;
  }

  if (digits.startsWith("880") && digits.length >= 13) {
    const national = digits.slice(3);
    if (national.startsWith("0")) {
      return `+880${national.replace(/^0+/, "")}`;
    }
    if (/^1[3-9]\d{8}/.test(national)) {
      return `+880${national.slice(0, 10)}`;
    }
    return `+${digits}`;
  }

  // Bangladesh local: 01XXXXXXXXX
  if (digits.length === 11 && digits.startsWith("01")) {
    return `+880${digits.slice(1)}`;
  }

  // BD mobile without leading 0: 1[3-9]XXXXXXXX
  if (digits.length === 10 && /^1[3-9]\d{8}$/.test(digits) && defaultRegion === "BD") {
    return `+880${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // Valid international (must not start with 0)
  if (!digits.startsWith("0") && digits.length >= 11 && digits.length <= 15) {
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
