/**
 * Reminder jobs: missed social/GBP posts & missed GMB review replies
 * Runs on an interval from server bootstrap.
 */
import prisma from "../db.js";
import { notifyMissedPost, notifyMissedReview } from "./notifyService.js";

const POST_REMINDER_HOURS = Number(process.env.POST_REMINDER_HOURS || 24);
const REVIEW_REMINDER_HOURS = Number(process.env.REVIEW_REMINDER_HOURS || 12);
const CHECK_INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS || 60 * 60 * 1000); // 1h

function hoursSince(date) {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60);
}

async function alreadyNotifiedToday(userId, type) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await prisma.notificationLog.count({
    where: { userId, type, createdAt: { gte: start } },
  });
  return count > 0;
}

export async function runReminderSweep() {
  const users = await prisma.user.findMany({
    where: {
      accountStatus: { in: ["trial", "active"] },
      OR: [{ emailVerified: true }],
    },
  });

  let posts = 0;
  let reviews = 0;

  for (const user of users) {
    const postAge = Math.min(
      hoursSince(user.lastSocialPostAt),
      hoursSince(user.lastGbpPostAt)
    );

    if (postAge >= POST_REMINDER_HOURS) {
      if (!(await alreadyNotifiedToday(user.id, "missed_post"))) {
        await notifyMissedPost(user.id, Math.floor(postAge === Infinity ? POST_REMINDER_HOURS : postAge));
        posts += 1;
      }
    }

    const reviewAge = hoursSince(user.lastReviewReplyAt);
    if (user.pendingReviewCount > 0 || reviewAge >= REVIEW_REMINDER_HOURS) {
      if (!(await alreadyNotifiedToday(user.id, "missed_review"))) {
        await notifyMissedReview(user.id, user.pendingReviewCount || null);
        reviews += 1;
      }
    }
  }

  if (posts || reviews) {
    console.log(`[reminders] missed posts: ${posts}, missed reviews: ${reviews}`);
  }
  return { posts, reviews, checked: users.length };
}

export function startReminderScheduler() {
  console.log(
    `Reminder scheduler: every ${CHECK_INTERVAL_MS / 60000}m | post>${POST_REMINDER_HOURS}h | review>${REVIEW_REMINDER_HOURS}h`
  );
  // Initial delay 30s so server finishes boot
  setTimeout(() => {
    runReminderSweep().catch(console.error);
    setInterval(() => runReminderSweep().catch(console.error), CHECK_INTERVAL_MS);
  }, 30_000);
}

/** Call after successful generate actions to stamp activity */
export async function stampActivity(userId, action) {
  const data = {};
  if (action === "social_post") data.lastSocialPostAt = new Date();
  if (action === "gbp_post") data.lastGbpPostAt = new Date();
  if (action === "review_reply") {
    data.lastReviewReplyAt = new Date();
    data.pendingReviewCount = 0;
  }
  if (Object.keys(data).length === 0) return;
  await prisma.user.update({ where: { id: userId }, data });
}

export async function setPendingReviews(email, count) {
  await prisma.user.update({
    where: { email: (email || "").trim().toLowerCase() },
    data: { pendingReviewCount: Math.max(0, Number(count) || 0) },
  });
}
