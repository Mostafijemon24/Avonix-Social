import { LegalPage } from "@/components/public/LegalPage";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="17 September 2026"
      intro="This Privacy Policy explains how Avonix Social (“we”, “us”) collects, uses, and shares information when you use https://social.avonixai.com and related APIs."
      sections={[
        {
          title: "Who we are",
          body: [
            "Avonix Social is an SEO and social publishing platform operated from Dhaka, Bangladesh. Contact: support@avonixsocial.com. Address: House 42, Road 11, Banani, Dhaka-1213, Bangladesh.",
          ],
        },
        {
          title: "Information we collect",
          body: [
            "Account data: name, email, phone (if provided), company, password hash, and login session tokens.",
            "Billing data: plan, credits, and payment-card verification status. We do not store full card numbers on our servers; card collection is handled by our payment processor.",
            "Workspace and content data: sitemaps, keywords, generated drafts, schedules, and publish logs you create in the product.",
            "Connected social accounts: when you connect Facebook, Instagram, Google Business Profile, or LinkedIn, we receive OAuth tokens and profile/page identifiers needed to list pages and publish content you approve.",
            "Support data: tickets, contact-form messages, and related email.",
            "Technical data: IP address, browser type, and basic server logs used for security and debugging.",
          ],
        },
        {
          title: "How we use information",
          body: [
            "To create and secure your account, send login and password-reset codes, and provide the dashboard.",
            "To generate and schedule social and Google Business Profile content you request.",
            "To publish to Pages and profiles you connect, only after you authorize the connection.",
            "To bill plans, enforce credit limits, and prevent abuse.",
            "To respond to support requests and meet legal obligations.",
          ],
        },
        {
          title: "Facebook, Instagram, and other platforms",
          body: [
            "If you connect Meta (Facebook/Instagram), we use Facebook Login for Business and Page permissions to list Pages you manage and to publish posts you create in Avonix Social. We do not sell your Meta data. We do not use Page data to build unrelated ad profiles. Tokens are stored encrypted at rest on our server and used only to operate the connection you enabled.",
            "You can disconnect a Page or Instagram account at any time from Dashboard → Connections. Disconnecting stops new API calls with that token.",
            "Google Business Profile and LinkedIn connections work the same way: we store tokens only to publish and manage content you request.",
          ],
        },
        {
          title: "Sharing",
          body: [
            "We share data with service providers who help us run the product: hosting, email delivery, AI generation (OpenRouter), and payment processing. They may process data only on our instructions.",
            "We share content with Facebook, Instagram, Google, or LinkedIn when you publish or connect those accounts.",
            "We may disclose information if required by law or to protect the service, users, or the public.",
            "We do not sell personal information.",
          ],
        },
        {
          title: "Retention",
          body: [
            "We keep account and workspace data while your account is active. After deletion we remove or anonymize personal data within a reasonable period, except records we must keep for billing, security, or law.",
            "OAuth tokens are kept until you disconnect the account or delete your Avonix Social account.",
          ],
        },
        {
          id: "data-deletion",
          title: "Your rights and data deletion",
          body: [
            "You may access, update, or delete your account data. Email support@avonixsocial.com from your registered address with the subject “Delete my Avonix Social data”. We will disconnect social tokens and delete or anonymize personal data associated with that account, typically within 30 days.",
            "You can also disconnect Facebook or Instagram from Dashboard → Connections, or remove Avonix Social from your Facebook Settings → Apps and Websites. That stops our access to that Meta login.",
            "If you are in a region with additional privacy rights, contact us and we will honor applicable access, correction, and deletion requests.",
          ],
        },
        {
          title: "Cookies and similar technology",
          body: [
            "We use essential cookies and local storage for sign-in sessions and workspace selection. We do not use advertising cookies on the public marketing pages.",
          ],
        },
        {
          title: "Children",
          body: [
            "Avonix Social is for businesses and agencies. It is not directed at children under 16. We do not knowingly collect data from children.",
          ],
        },
        {
          title: "Changes",
          body: [
            "We may update this policy. The “Last updated” date at the top will change. Continued use of the service after an update means you accept the revised policy.",
          ],
        },
        {
          title: "Contact",
          body: [
            "Privacy questions: support@avonixsocial.com or https://social.avonixai.com/contact",
          ],
        },
      ]}
    />
  );
}
