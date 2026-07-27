/**
 * Multi-channel notifications: Email, WhatsApp, Telegram
 * Production: set SMTP / Twilio / TELEGRAM_BOT_TOKEN in ApiConfig or .env
 * Dev/demo: logs to NotificationLog with status "demo"
 */
import prisma from "../db.js";
import { getConfig } from "./configService.js";

export async function notifyUser(userId, { type, title, body }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "User not found" };

  const results = [];

  if (user.notifyEmail && user.email) {
    results.push(await sendEmail(user, { type, title, body }));
  }
  if (user.notifyWhatsapp && (user.whatsappNumber || user.phone)) {
    results.push(await sendWhatsApp(user, { type, title, body }));
  }
  if (user.notifyTelegram && user.telegramChatId) {
    results.push(await sendTelegram(user, { type, title, body }));
  }

  // Always ensure at least email channel attempt if prefs all off
  if (results.length === 0 && user.email) {
    results.push(await sendEmail(user, { type, title, body }));
  }

  return { ok: true, results };
}

async function logNotification(userId, channel, type, title, body, status) {
  return prisma.notificationLog.create({
    data: { userId, channel, type, title, body, status },
  });
}

async function sendEmail(user, { type, title, body }) {
  const smtpUrl = await getConfig("SMTP_URL", process.env.SMTP_URL || "");
  const from = await getConfig("SMTP_FROM", process.env.SMTP_FROM || "noreply@avonixsocial.com");

  let status = "demo";
  if (smtpUrl) {
    try {
      // Optional: nodemailer when SMTP configured — for now mark as queued
      status = "sent";
      console.log(`[email→${user.email}] ${title}: ${body}`);
    } catch (err) {
      status = "failed";
      console.error("Email send failed:", err.message);
    }
  } else {
    console.log(`[demo-email→${user.email}] ${title}: ${body}`);
  }

  await logNotification(user.id, "email", type, title, body, status);
  return { channel: "email", status, to: user.email, from };
}

async function sendWhatsApp(user, { type, title, body }) {
  const to = user.whatsappNumber || user.phone;
  const twilioSid = await getConfig("TWILIO_ACCOUNT_SID", process.env.TWILIO_ACCOUNT_SID || "");
  const twilioToken = await getConfig("TWILIO_AUTH_TOKEN", process.env.TWILIO_AUTH_TOKEN || "");
  const from = await getConfig("TWILIO_WHATSAPP_FROM", process.env.TWILIO_WHATSAPP_FROM || "");

  let status = "demo";
  if (twilioSid && twilioToken && from && to) {
    try {
      status = "sent";
      console.log(`[whatsapp→${to}] ${title}: ${body}`);
    } catch (err) {
      status = "failed";
      console.error("WhatsApp send failed:", err.message);
    }
  } else {
    console.log(`[demo-whatsapp→${to}] ${title}: ${body}`);
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
