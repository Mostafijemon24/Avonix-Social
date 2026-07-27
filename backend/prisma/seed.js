import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PACKAGES = [
  { slug: "free", name: "Free Trial", monthlyCredits: 10, priceUsd: 0, renewalDays: 30 },
  { slug: "pro", name: "Pro Growth", monthlyCredits: 300, priceUsd: 29, renewalDays: 30 },
  { slug: "agency", name: "Agency Enterprise", monthlyCredits: 9999, priceUsd: 89, renewalDays: 30 },
];

const DEFAULT_CONFIG = [
  { key: "CREDITS_PER_DOLLAR", value: "100" },
  { key: "MARGIN_MULTIPLIER", value: "1.3" },
  { key: "STRIPE_SECRET_KEY", value: "" },
  { key: "STRIPE_WEBHOOK_SECRET", value: "" },
  { key: "PAYPAL_CLIENT_ID", value: "" },
  { key: "PAYPAL_CLIENT_SECRET", value: "" },
  { key: "OPENROUTER_API_KEY", value: "" },
];

async function main() {
  console.log("Seeding packages...");
  for (const pkg of PACKAGES) {
    await prisma.package.upsert({
      where: { slug: pkg.slug },
      update: pkg,
      create: pkg,
    });
  }

  console.log("Seeding API config...");
  for (const cfg of DEFAULT_CONFIG) {
    await prisma.apiConfig.upsert({
      where: { key: cfg.key },
      update: {},
      create: cfg,
    });
  }

  const adminCount = await prisma.admin.count();
  console.log(`Seed complete. Super Admins in DB: ${adminCount}/2`);
  console.log("To create admins (VPS terminal only): npm run admin:create");
  console.log("NOTE: Seed never creates Super Admins — CLI only, max 2, 2FA mandatory.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
