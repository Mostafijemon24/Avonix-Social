# Avonix Social — সম্পূর্ণ সিস্টেম, লজিক ও ফাংশন গাইড

এই ডকুমেন্ট **বর্তমান লাইভ প্রোডাক্ট** (`https://social.avonixai.com`) কীভাবে কাজ করে, সেটার সত্যি চিত্র।  
মার্কেটিং কপি নয় — কোড অনুযায়ী **আসল লজিক, মেনু, বাটন, গেট, এবং যেখানে ডামি/অসম্পূর্ণ**।

উদ্দেশ্য: ChatGPT / অন্য AI-কে এই ফাইল দিয়ে প্রম্পট লিখে সাইটকে আরও প্রফেশনাল, লজিক্যালি সঠিক ও ফাংশনাল করা।

---

## ১. প্রোডাক্ট কী হতে চায় (Vision)

Avonix Social একটি **SEO + সোশ্যাল পাবলিশিং অটোমেশন** প্ল্যাটফর্ম:

1. ক্লায়েন্টের ওয়েবসাইট `sitemap.xml` স্ক্যান করে।
2. হোমপেজ/সার্ভিস পেজ থেকে **প্রাইমারি + সেকেন্ডারি কিওয়ার্ড** ও লোকেশন বের করে।
3. **জিরো-ইমোজি**, কর্পোরেট টোনের পোস্ট তৈরি করে (Facebook, Instagram, LinkedIn, Google Business Profile / GMB)।
4. কিওয়ার্ড-যুক্ত ইমেজ জেনারেট করে।
5. কানেক্টেড অ্যাকাউন্টে পাবলিশ / শিডিউল করে।
6. GBP রিভিউ রিপ্লাই অটোমেশন (Confirm-to-Reply / Full Auto) — **ভিজনে আছে, কোডে আংশিক**।
7. ক্রেডিট + ওয়ালেট বিলিং, এজেন্সি মাল্টি-ক্লায়েন্ট ওয়ার্কস্পেস, সুপার অ্যাডমিন প্যানেল।

---

## ২. টেক আর্কিটেকচার

```
ব্রাউজার (Next.js 14, পোর্ট 3000)
    │  /login /register /dashboard /admin
    │  Apache → social.avonixai.com
    ▼
Express API (পোর্ট 4000)  /api/*
    │  Prisma + SQLite
    ├─ OpenRouter (AI টেক্সট/ইমেজ)
    ├─ SMTP (ইমেইল OTP)
    ├─ Twilio (WhatsApp — কনফিগ থাকলে)
    ├─ Telegram Bot
    ├─ Facebook / Instagram (Meta Graph)
    ├─ LinkedIn OAuth
    └─ Google Business Profile OAuth
```

| স্তর | টেক | পাথ |
|------|------|------|
| ফ্রন্টএন্ড | Next.js 14 App Router, React 18, Tailwind | `src/` |
| ব্যাকএন্ড | Express, Prisma, SQLite | `backend/` |
| লাইভ | PM2 `avonix-social-web` + `avonix-social-api` | `/var/www/avonix-social` |
| অপশনাল | Python FastAPI AI engine | `ai-engine/` (পোর্ট 8001, মূল ফ্লোতে বাধ্যতামূলক নয়) |

**দুই ধরনের ইউজার (আলাদা লগইন):**

| কে | URL | অথেন্টিকেশন |
|----|-----|-------------|
| সাধারণ ইউজার / এজেন্সি | `/login` বা `/register` | ইমেইল + পাসওয়ার্ড, JWT ৭ দিন |
| সুপার অ্যাডমিন | `/admin/login` | পাসওয়ার্ড + Authenticator 2FA, JWT ৩০ মিনিট আইডল |

হোমপেজের **Sign In** সাধারণ ইউজারের। অ্যাডমিন হোমপেজে লিংক নেই।

---

## ৩. পাবলিক সাইট — মেনু ও বাটন

হেডার (`PublicHeader` + `PUBLIC_NAV`):

| বাটন / লিংক | URL | কাজ |
|-------------|-----|------|
| Home | `/` | মার্কেটিং হোম |
| Features | `/features` | ফিচার কপি |
| How It Works | `/how-it-works` | ওয়ার্কফ্লো কপি |
| GBP Automation | `/gbp` | Confirm-to-Reply vs Full Auto ব্যাখ্যা |
| Pricing & Plans | `/pricing` | Free / Pro / Agency কার্ড |
| API Integrations | `/api-integrations` | ইন্টিগ্রেশন কপি |
| About Us | `/about` | কোম্পানি কপি |
| Support | `/support` | FAQ + টিকেট ফর্ম |
| Contact Us | `/contact` | লিড ফর্ম → অ্যাডমিন CRM |
| **Sign In** | `/login` | ইউজার সাইন ইন |
| **Register** | `/register` | অ্যাকাউন্ট তৈরি |
| `/signin` `/sign-in` | রিডাইরেক্ট `/login` | |
| `/signup` `/sign-up` | রিডাইরেক্ট `/register` | |

হোম CTA:

- **Register & Launch Dashboard** → `/register`
- **Explore Automation Workflow** → `/how-it-works`
- **Extract Keywords** (সাইটম্যাপ ডেমো) → **ডামি**: API কলে যায় না। ডিফল্ট URL `https://nexadigital.com/sitemap.xml`। ফেক রেজাল্ট দেখায় (কিওয়ার্ড “Enterprise Local SEO Services”, Manhattan)।

কন্টাক্ট/সাপোর্ট ফর্ম → `POST /api/leads` → সুপার অ্যাডমিন `/admin/leads`।

---

## ৪. ইউজার লগইন / রেজিস্ট্রেশন লজিক

একই কম্পোনেন্ট: `RegisterFlow` (`src/components/auth/RegisterFlow.tsx`)।  
`/login` ও `/register` দুটোতেই চলে। ডিফল্ট স্টেপ **Sign In**।

### স্টেপ মেশিন

```
signin ⇄ register → verify → card → Dashboard
signin → forgot → reset → signin
```

| স্টেপ | স্ক্রিন | বাটন | API |
|--------|---------|------|-----|
| `signin` | ইমেইল + পাসওয়ার্ড | Sign In, Forgot password?, New account? Register | `POST /api/auth/login` |
| `register` | নাম, ইমেইল, ফোন (ঐচ্ছিক), কোম্পানি, পাসওয়ার্ড ×২ | Send Email Verification Code | `POST /api/auth/register` |
| `verify` | ৬ ডিজিট ইমেইল OTP | Verify Email, Resend | `POST /api/auth/verify` |
| `card` | কার্ড নম্বর, MM, YYYY, CVC | Save Card & Start Free Trial | `POST /api/auth/card` |
| `forgot` | ইমেইল | Send Reset Code | `POST /api/auth/forgot-password` |
| `reset` | ইমেইল কোড + নতুন পাসওয়ার্ড | Update Password | `POST /api/auth/reset-password` |

### পাসওয়ার্ড নিয়ম (ক্লায়েন্ট + সার্ভার একই)

- কমপক্ষে ১২ অক্ষর
- বড় হাত, ছোট হাত, নম্বর, স্পেশাল ক্যারেক্টার (`!@#$…`)
- Generate বাটন দিয়ে শক্ত পাসওয়ার্ড তৈরি করা যায়

### ভেরিফিকেশন গেট (ড্যাশবোর্ড ব্লক)

কোডে **ফুলি ভেরিফায়েড** = `emailVerified && cardOnFile`।  
README-তে ফোন OTP-ও বলা আছে, কিন্তু **বর্তমান ফ্লো ইমেইল OTP + কার্ড**। ফোন ফিল্ড অপশনাল।

`DashboardAuthGuard`:

- সেশন নেই → `/login`
- ইমেইল ভেরিফাই না → `/register?email=…&step=verify`
- কার্ড নেই → `/register?email=…&step=card`
- ঠিক থাকলে ড্যাশবোর্ড

সেশন: `localStorage` (`avonix-social-email`, `avonix-social-session`), JWT **৭ দিন**, হেডার `Authorization: Bearer`।

### কার্ড লজিক (`attachCard`)

- ১৩–১৯ ডিজিট, **Luhn চেক**
- প্রোডাকশনে টেস্ট কার্ড ব্লক (`4242…` ইত্যাদি)
- সফল হলে: Free Trial, `accountStatus: "trial"`, প্ল্যান ক্রেডিট (ডিফল্ট ১০), ৩০ দিন সাবস্ক্রিপশন `gateway: "card_on_file"`
- **আসল Stripe চার্জ এখন হয় না** — কার্ড নম্বর ভ্যালিডেট করে “on file” মার্ক করে

### অ্যাডমিন থেকে ইউজার তৈরি

`/admin/users` → Create User: ইমেইল, প্ল্যান, পাসওয়ার্ড, ঐচ্ছিক ক্রেডিট, **Unlimited credits** টিক।  
এই ইউজার **OTP/কার্ড ছাড়াই** লগইন করতে পারে (`emailVerified` + `cardOnFile` true)।

**INT লিমিট:** `remainingCredits` SQLite INT, সর্বোচ্চ `2,147,483,647`।  
বিশাল সংখ্যা (যেমন `1000000000000`) দিলে সিস্টেম সেটাকে **Unlimited** ধরে, কলামে সেভ করে না। আনলিমিটেড চাইলে শুধু টিক দিতে হবে।

---

## ৫. ড্যাশবোর্ড — মেনু, বাটন, আসল কাজ

সাইডবার `DASHBOARD_NAV`:

| মেনু | URL | আসল স্ট্যাটাস |
|------|-----|----------------|
| Dashboard | `/dashboard` | প্ল্যান/ক্রেডিট/ইউজেজ লাইভ; **অ্যানালিটিক্স সংখ্যা হার্ডকোডেড** |
| Content Studio | `/dashboard/social-post` | **মূল ওয়ার্কিং মডিউল** (৪ স্টেপ) |
| Connections | `/dashboard/connections` | **রিয়েল OAuth** |
| Review Reply | `/dashboard/review-reply` | **আংশিক / ডেমো রিভিউ** |
| Notification | `/dashboard/notification` | প্রেফারেন্স + লগ **রিয়েল** |
| Report | `/dashboard/report` | **ডামি PDF** (টোস্ট + ফেক ফাইলনেম) |
| Plan & Price | `/dashboard/billing` | প্ল্যান/ওয়ালেট UI; টপ-আপ গেটওয়ে নির্ভর |
| Support | `/dashboard/support` | টিকেট → লিড টেবিল |

হেডারে আরও:

- **Client Workspace** সুইচার (একাধিক ক্লায়েন্ট)
- Credits / Unlimited / Wallet ব্যালেন্স
- **Top-Up / Upgrade** → `/dashboard/billing`
- **Sign Out** → হোম, সেশন ক্লিয়ার

সাইডবার নিচে **Live Status:** Facebook / Instagram / LinkedIn / Google Business = `Connected` | `Linked` | `Not connected`।  
**Manage connections →** `/dashboard/connections`।

লো ক্রেডিট / জিরো ক্রেডিট / frozen হলে টপ ব্যানার + Billing লিংক।

### যে পেজ আছে কিন্তু মেনুতে নেই

| URL | আচরণ |
|-----|------|
| `/dashboard/gbp-post` | Content Studio-তে রিডাইরেক্ট |
| `/dashboard/sitemap` | Content Studio-তে রিডাইরেক্ট |
| `/dashboard/analytics` | Dashboard-এ রিডাইরেক্ট |

অর্থাৎ সাইটম্যাপ পার্স ও GBP পোস্ট **আলাদা মডিউল নয়** — Content Studio-র ভিতরে মিশে আছে।

---

## ৬. Content Studio — ধাপে ধাপে লজিক

ফাইল: `src/app/dashboard/social-post/page.tsx`  
ব্যাকএন্ড: `autoPosterService.js`, `siteAnalyzer.js`

### স্টেপ ১ — Website

- ইনপুট: ওয়েবসাইট URL
- সিস্টেম সাইটম্যাপ খুঁজে পেজ লিস্ট বের করে (সর্বোচ্চ ~১৫ URL)
- কিওয়ার্ড/লোকেশন ক্যাশ হয় অ্যাকটিভ **Client Workspace**-এ

### স্টেপ ২ — Pages

- কোন পেজগুলো থেকে পোস্ট হবে, সেগুলো সিলেক্ট
- প্রতি পেজে: ১ প্রাইমারি + ১ সেকেন্ডারি + ৪ জেনারেল কিওয়ার্ড

### স্টেপ ৩ — Create

- **Tone:** Professional, Enthusiastic, Empathetic, Authoritative, Storytelling
- **ইমেজ সোর্স:** `auto` | `ai` (OpenRouter) | `free`
- প্ল্যাটফর্ম: Facebook, Instagram, LinkedIn, GMB
- জিরো-ইমোজি, লিংক স্ট্রিপ নিয়ম ব্যাকএন্ডে
- ওয়ার্ড রেঞ্জ (আনুমানিক): FB ১২০+, IG ৭০+, LI ১৫০+, GMB ৯০+
- ইমেজ সাইজ: FB 1920×1008, LI 1920×1005, GMB 1200×900, IG 1080×1080

### স্টেপ ৪ — Publish

পোস্ট স্ট্যাটাস: `draft` | `scheduled` | `published`  
পাবলিশ হলে **লক** (`locked`) — আবার একই URL+প্ল্যাটফর্ম+কিওয়ার্ড ডুপ্লিকেট পাবলিশ ব্লক (`fingerprint`)।

বাটনগুলো (পোস্ট কার্ডে):

- Publish now (OAuth Connected থাকতে হবে)
- Schedule / Unschedule
- Rewrite / Regenerate
- Image attach / regenerate
- Archive

ট্যাব: Active vs Archive।

কানেকশন না থাকলে পোস্ট জেনারেট হয়, কিন্তু লাইভ পাবলিশ ফেল করে — Connections-এ যেতে বলে।

---

## ৭. সোশ্যাল কানেক্ট সিস্টেম

পেজ: `/dashboard/connections`  
সার্ভিস: `connectionsService.js`, পাবলিশ: `publishService.js`  
রাউট: `/api/connections/*`

প্রতিটি **Client Workspace**-এ আলাদা কানেকশন। এজেন্সি এক ইউজারে অনেক ক্লায়েন্ট রাখতে পারে; প্রতি ক্লায়েন্টের নিজস্ব FB/IG/LI/GBP।

### চার প্ল্যাটফর্ম

| UI নাম | `provider` | কী লাগে পাবলিশে |
|--------|------------|------------------|
| Facebook Page | `facebook` | Business Page + Page টোকেন |
| Instagram Business | `instagram` | IG Business, FB Page-এর সাথে লিংকড |
| Google Business Profile | `google_business` | GBP OAuth `business.manage` |
| LinkedIn Page | `linkedin` | Sign In + Share (বা Community Management মোড) |

### দুই ধরনের লিংক

| `authType` | স্ট্যাটাস UI | পাবলিশ? |
|------------|--------------|---------|
| `oauth` + টোকেন | **Connected** (`publishReady`) | হ্যাঁ |
| `manual` (শুধু URL) | **Linked** | না — “OAuth required to publish” |
| নেই | **Off / Not connected** | না |

বাটন:

- **Connect with OAuth** → `/api/connections/oauth/:provider/start` → প্ল্যাটফর্ম লগইন → কলব্যাক  
  `https://social.avonixai.com/api/connections/oauth/{provider}/callback`  
  তারপর `/dashboard/connections?connected=` বা `?error=`
- **Disconnect** → অ্যাকাউন্ট ডিলিট
- ম্যানুয়াল URL সেভ (লিংকড, পাবলিশ নয়)

### পাবলিশ পাথ

1. Content Studio → `POST /api/auto-poster/publish`
2. অথবা `PublishBar` → `POST /api/connections/publish`

ম্যাপিং:

- সোশ্যাল পোস্ট → Facebook / Instagram / LinkedIn
- GBP পোস্ট ও রিভিউ রিপ্লাই → শুধু `google_business`

OAuth অ্যাপ সেটআপ না থাকলে UI-তে setup স্ট্যাটাস দেখায় (`GET /api/connections/setup`)।

### LinkedIn বিশেষ নিয়ম (প্রোডাকশন পাঠ)

LinkedIn **এক অ্যাপে** Sign In/Share এবং Community Management API একসাথে চালায় না।  
ভুল অ্যাপ/স্কোপ হলে LinkedIn “Bummer” পেজ। `.env`: `LINKEDIN_CLIENT_ID`, `LINKEDIN_SHARE_ON_LINKEDIN`, `LINKEDIN_COMMUNITY_MANAGEMENT`।

---

## ৮. ক্রেডিট, ওয়ালেট, প্ল্যান

### প্ল্যান (সিড)

| slug | নাম | প্রাইস | মাসিক ক্রেডিট | ওয়ার্কস্পেস লিমিট |
|------|------|--------|----------------|-------------------|
| `free` | Free Trial | $0 | 10 | 1 |
| `pro` | Pro Growth | $29 | 300 | 10 |
| `agency` | Agency Enterprise | $89 | **9999** (আনলিমিটেড নয়) | 100 |

**আসল Unlimited** = অ্যাডমিন ফ্ল্যাগ `unlimitedCredits` (ক্রেডিট কাটে না)। UI-তে “Unlimited” দেখায়।

### দুই স্তরের খরচ (ইনকনসিস্টেন্সি — ঠিক করার জায়গা)

ফ্রন্টএন্ড ব্যাজ (`src/lib/credits.ts`) ফিক্সড:

- sitemap_parse = 1
- social_post = 2
- gbp_post = 1
- review_reply = 1

ব্যাকএন্ড AI আসলে **OpenRouter USD খরচ** থেকে ক্রেডিট:

```
credits = max(1, ceil(actualCostUSD × MARGIN_MULTIPLIER × CREDITS_PER_DOLLAR))
```

ডিফল্ট: `$1 = 100 credits`, মার্জিন `1.3`।  
সাইটম্যাপ পার্স ফিক্সড ১ ক্রেডিট।

### খরচের অগ্রাধিকার

1. প্ল্যান `remainingCredits`
2. শেষ হলে **Pro/Agency ওয়ালেট USD** (Free ওয়ালেট খরচ করতে পারে না)
3. `unlimitedCredits` → কাটে না
4. দুটোই শূন্য → এরর / আপগ্রেড মেসেজ
5. ওয়ালেটও খালি + ক্রেডিট ০ → অ্যাকাউন্ট **frozen**

ওয়ালেট টপ-আপ: Pro/Agency, $1–$10,000।  
প্রোডাকশনে Stripe/PayPal না থাকলে / `ALLOW_DEMO_TOPUP` ছাড়া **501**।

`remainingCredits` INT — বিশাল সংখ্যা রাখা যায় না; আনলিমিটেড ফ্ল্যাগ ব্যবহার করতে হবে।

---

## ৯. Client Workspace (মাল্টি-ক্লায়েন্ট)

মডেল: `ClientWorkspace` — এক ইউজার, অনেক ক্লায়েন্ট।

প্রতি ওয়ার্কস্পেসে:

- নাম, ওয়েবসাইট, সাইটম্যাপ ক্যাশ, কিওয়ার্ড, লোকেশন
- আলাদা `ConnectedAccount` সেট
- আলাদা Studio পোস্ট

সুইচ করলে Connections ও Content Studio সেই ক্লায়েন্টের ডেটা দেখায়।  
কমপক্ষে ১টা ওয়ার্কস্পেস রাখতে হয়। ডিলিট করলে সেই ক্লায়েন্টের কানেকশনও যায়।  
`unlimitedCredits` থাকলে ওয়ার্কস্পেস লিমিট ১০০।

---

## ১০. অন্যান্য ড্যাশবোর্ড মডিউল

### Review Reply (`/dashboard/review-reply`)

- Confirm-to-Reply / Full Auto — **এখন UI টোস্ট**, GBP থেকে লাইভ রিভিউ পুল নয়
- ডেমো রিভিউ: হার্ডকোডেড “John Doe” ৫★
- AI ড্রাফট: `POST /api/generate` `action: review_reply`
- PublishBar-এ লাইভ `reviewName` লাগে — ডেমোতে ব্লক

### Notification

ইমেইল / WhatsApp / Telegram অন-অফ, নম্বর/চ্যাট আইডি সেভ, ডেলিভারি লগ।  
কী না থাকলে স্ট্যাটাস **demo** (কনসোলে লগ)।  
রিমাইন্ডার: মিসড পোস্ট / পেন্ডিং রিভিউ (শিডিউলার)।

### Report

হোয়াইট-লেবেল PDF বলা আছে — **ডাউনলোড হয় না**, শুধু টোস্ট + ফেক নাম `Nexa_Digital_SEO_Performance_July2026.pdf`।

### Dashboard হোম অ্যানালিটিক্স

হার্ডকোড: Avg Keyword Rank `#2.8`, Organic impressions `62,400`, GBP Map `2,150`।  
GBP রিপ্লাই % = `min(99.9, 85 + gbpReplies×2)` — আসল Google Analytics নয়।

### Billing

প্ল্যান কার্ড, সাবস্ক্রাইব UI, ওয়ালেট, ক্রেডিট ইউজেজ।  
পেমেন্ট গেটওয়ে পুরো প্রোডাকশন-রেডি নয়।

---

## ১১. সুপার অ্যাডমিন

লগইন: `https://social.avonixai.com/admin/login`  
ওয়েব থেকে অ্যাডমিন রেজিস্টার **বন্ধ**। শুধু VPS:

```bash
cd /var/www/avonix-social/backend
npm run admin:create    # সর্বোচ্চ ২ জন
npm run admin:list
npm run admin:delete -- email@domain.com
npm run admin:forgot -- email@domain.com   # কোড টার্মিনালে ছাপায় (Gmail না এলে)
```

লগইন: পাসওয়ার্ড → Authenticator ৬ ডিজিট।  
আইডল ৩০ মিনিট → সেশন মুছে `/admin/login?reason=idle`।  
ফরগট পাসওয়ার্ডে **ইমেইল কোড + Authenticator দুটোই লাগে**। Authenticator হারালে `delete` + `create`।

অ্যাডমিন মেনু:

| পেজ | কাজ |
|-----|------|
| `/admin` | ইউজার/সাব/রেভিনিউ স্ট্যাট |
| `/admin/users` | ইউজার CRUD, আনলিমিটেড, পাসওয়ার্ড সেট |
| `/admin/users/[id]` | ডিটেইল, প্ল্যান চেঞ্জ |
| `/admin/leads` | কন্টাক্ট/সাপোর্ট লিড |
| `/admin/subscriptions` | সাবস্ক্রিপশন |
| `/admin/revenue` | পেমেন্ট লগ |
| `/admin/settings` | API কী, প্ল্যান প্রাইস/ক্রেডিট, অ্যাডমিন পাসওয়ার্ড |

---

## ১২. ডেটা মডেল (সংক্ষেপ)

| মডেল | অর্থ |
|------|------|
| `User` | অ্যাকাউন্ট, ক্রেডিট, ওয়ালেট, ভেরিফাই, freeze |
| `Package` | free/pro/agency |
| `ClientWorkspace` | প্রতি ক্লায়েন্ট সাইট |
| `ConnectedAccount` | OAuth/ম্যানুয়াল সোশ্যাল |
| `StudioPost` | ড্রাফট/শিডিউল/পাবলিশড পোস্ট |
| `UsageLog` | AI খরচ |
| `WalletTransaction` | টপ-আপ/ডেবিট |
| `VerificationCode` | OTP |
| `Admin` | সুপার অ্যাডমিন + TOTP |
| `Lead` | কন্টাক্ট/সাপোর্ট |
| `Subscription` / `PaymentLog` | বিলিং রেকর্ড |
| `NotificationLog` | অ্যালার্ট লগ |

অ্যাকাউন্ট স্ট্যাটাস: `pending_verification` | `trial` | `active` | `frozen`।

---

## ১৩. গুরুত্বপূর্ণ API (ইউজার)

বেস: `/api`

- অথ: `/auth/register`, `/verify`, `/card`, `/login`, `/forgot-password`, `/reset-password`, `/status/:email`
- স্টেট: `GET /users/:email/credits`
- কানেকশন: `GET/POST /connections`, OAuth start/callback, `POST /connections/publish`
- ওয়ার্কস্পেস: `/workspaces` CRUD + activate + sitemap
- স্টুডিও: `/auto-poster/analyze-website`, `/generate`, `/publish`, `/schedule`, `/rewrite`, …
- বিলিং: `/wallet/:email`, `/wallet/topup`, `/billing/subscribe`, `/generate`
- লিড: `POST /leads`

অ্যাডমিন: `/api/admin/*` (JWT + 2FA সেশন)।

---

## ১৪. যা আসল vs যা ডামি / ভাঙা লজিক (প্রায়োরিটি)

এগুলো ঠিক করলে প্রোডাক্ট “প্রফেশনাল ও রাইট লজিক” হবে:

1. **হোম সাইটম্যাপ ডেমো** — লাইভ `site/analyze` বা স্পষ্ট “Demo only” লেবেল।
2. **ড্যাশবোর্ড অ্যানালিটিক্স** — হার্ডকোড বাদ; না থাকলে “Connect Google Search Console” এম্পটি স্টেট।
3. **Report PDF** — আসল জেনারেট, অথবা মেনু থেকে সরিয়ে দাও।
4. **Review Reply** — GBP API থেকে রিভিউ লিস্ট; Confirm/Auto সত্যি মোড; ডেমো John Doe সরান।
5. **কার্ড অন ফাইল** — Stripe SetupIntent / আসল পেমেন্ট মেথড, শুধু Luhn নয়।
6. **ওয়ালেট টপ-আপ** — Stripe/PayPal ওয়েবহুক সিগনেচার ভেরিফাই + রিনিউ।
7. **ক্রেডিট UI vs API** — এক সোর্স অফ ট্রুথ; ইউজার যা দেখে তাই কাটে।
8. **Agency “Unlimited”** — মার্কেটিং ৯৯৯৯, আনলিমিটেড ফ্ল্যাগ আলাদা — কপি মিলান।
9. **ফোন OTP** — README বলে, কোডে নেই — যোগ করো বা ডক থেকে বাদ দাও।
10. **GBP/Sitemap আলাদা মেনু** — আবার আলাদা মডিউল, অথবা ইউজারকে স্পষ্ট করো যে সব Studio-তে।
11. **Meta পাবলিশ স্কোপ** — ডিফল্ট এনভে `pages_manage_posts` / `instagram_content_publish` যাতে Connect-এর পর পাবলিশ ফেল না করে।
12. **ইমেইল ডেলিভারি** — SMTP sent হলেও Gmail ইনবক্সে নাও আসতে পারে; ট্রানসাকশনাল ESP বা অ্যাডমিন CLI ফলব্যাক UI-তে দেখাও।
13. **ওয়েবহুক** — Stripe/PayPal সিগনেচার চেক।
14. **কন্টেন্ট কোয়ালিটি** — জিরো-ইমোজি, কিওয়ার্ড ডেনসিটি, CTA নিয়ম এক জায়গায় ডক + টেস্ট।

---

## ১৫. ইউজার জার্নি (রাইট লজিক — কেমন হওয়া উচিত)

### নতুন ইউজার
1. Register → ইমেইল OTP → (ঐচ্ছিক ফোন) → পেমেন্ট মেথড → Free Trial ক্রেডিট।
2. প্রথম লগইন → Workspace তৈরি (ক্লায়েন্ট নাম + ওয়েবসাইট)।
3. Connections → চার প্ল্যাটফর্ম OAuth (Connected ছাড়া Publish ডিসেবল)।
4. Content Studio: সাইট → পেজ সিলেক্ট → টোন/ইমেজ → প্রিভিউ এডিট → Publish বা Schedule।
5. ক্রেডিট শেষ → Pro/Agency বা ওয়ালেট; নাহলে জেনারেশন ব্লক, পরিষ্কার CTA।

### এজেন্সি
1. একাধিক Workspace।
2. প্রতি ক্লায়েন্টে আলাদা OAuth (টোকেন মিক্স নয়)।
3. সুইচ করলে পোস্ট/কানেকশন বদলায় — গ্লোবাল পোস্ট অন্য ক্লায়েন্টে পাবলিশ হবে না।

### সুপার অ্যাডমিন
1. CLI দিয়ে তৈরি, 2FA বাধ্যতামূলক।
2. ইউজার বানালে পাসওয়ার্ড শেয়ার + ওয়েলকাম মেইল।
3. আনলিমিটেড = ফ্ল্যাগ, ক্রেডিট ফিল্ডে ট্রিলিয়ন নয়।

---

## ১৬. ChatGPT-এর জন্য রেডি প্রম্পট

নিচের ব্লক কপি করে ChatGPT-তে দিন। উপরে এই পুরো ফাইল (বা `docs/AVONIX-SOCIAL-SYSTEM-GUIDE.md`) অ্যাটাচ/পেস্ট করুন।

```
You are a senior product engineer and UX architect. I will paste a system guide for my live SaaS "Avonix Social" (Next.js 14 + Express + Prisma/SQLite + OpenRouter + Meta/LinkedIn/GBP OAuth).

Your job is NOT to invent a new product. Your job is to make THIS product more professional, logically consistent, and correctly functional.

Rules:
1. Treat the guide as source of truth for CURRENT behavior. Distinguish what already works vs dummy/incomplete.
2. Propose a target information architecture: public site, user auth, dashboard IA, admin, credits, OAuth, workspaces.
3. Define RIGHT business logic as explicit rules (if/then), especially:
   - verification gate (email OTP, card/Stripe, optional phone)
   - credit vs wallet vs unlimited vs frozen
   - OAuth Connected vs Linked vs Off and when Publish is allowed
   - one workspace = one client's tokens and posts (no cross-client publish)
   - Content Studio 4 steps and post lifecycle (draft/scheduled/published/locked/archive)
   - GBP review reply confirm vs auto (must be real, not toast)
4. Kill or replace dummy features: homepage fake sitemap, hardcoded dashboard analytics, fake PDF report, hardcoded John Doe review.
5. Unify credit display with backend USD→credit formula. Align marketing copy (Agency "unlimited") with actual 9999 vs unlimitedCredits flag.
6. Output:
   A) Product principles (10 bullets)
   B) Correct user journeys (new user, returning, agency, admin recovery)
   C) Screen-by-screen: keep / merge / rebuild, and exact button behaviors
   D) Data rules and API contract changes
   E) Phased implementation backlog: P0 (correctness/security), P1 (complete the promise), P2 (polish)
   F) A prompt I can give a coding agent to implement P0 only, file-aware (paths from the guide)
7. Do not suggest a rewrite in another stack. Stay on Next.js + Express + Prisma.
8. Prefer fewer honest screens over many fake ones.
```

---

## ১৭. কোড ম্যাপ (দ্রুত খোঁজা)

| বিষয় | ফাইল |
|------|------|
| পাবলিক মেনু | `src/lib/constants.ts`, `src/components/public/PublicHeader.tsx` |
| ইউজার অথ UI | `src/components/auth/RegisterFlow.tsx` |
| ইউজার অথ API | `backend/src/services/verifyService.js` |
| ড্যাশবোর্ড গার্ড | `src/components/dashboard/DashboardAuthGuard.tsx` |
| শেল/ক্রেডিট ব্যানার | `src/components/dashboard/DashboardShell.tsx` |
| Content Studio | `src/app/dashboard/social-post/page.tsx` |
| অটো পোস্টার | `backend/src/services/autoPosterService.js` |
| কানেকশন UI | `src/app/dashboard/connections/page.tsx` |
| OAuth/পাবলিশ | `backend/src/services/connectionsService.js`, `publishService.js` |
| ক্রেডিট | `backend/src/credits.js`, `src/lib/credits.ts` |
| ওয়ালেট | `backend/src/services/walletService.js` |
| ওয়ার্কস্পেস | `backend/src/services/workspaceService.js` |
| অ্যাডমিন CLI | `backend/scripts/admin-cli.js` |
| অ্যাডমিন অথ | `backend/src/services/adminAuthService.js` |
| স্কিমা | `backend/prisma/schema.prisma` |
| ডিপ্লয় | README → Production Deployment (VPS) |

---

*জেনারেটেড অ্যাজ-অফ কোডবেস স্টেট: Avonix Social, social.avonixai.com। ফিচার যোগ/বাদ হলে এই গাইড আপডেট করুন।*
