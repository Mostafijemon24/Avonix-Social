import { LegalPage } from "@/components/public/LegalPage";

export const metadata = { title: "Terms of Service" };

export default function TermsOfServicePage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="17 September 2026"
      intro="These Terms of Service (“Terms”) govern use of Avonix Social at https://social.avonixai.com. By creating an account or using the service, you agree to these Terms."
      sections={[
        {
          title: "The service",
          body: [
            "Avonix Social provides sitemap-based content generation, scheduling, and publishing to connected social and Google Business Profile accounts. Features depend on your plan and remaining credits.",
          ],
        },
        {
          title: "Accounts",
          body: [
            "You must provide accurate registration details and keep your password confidential. You are responsible for activity under your account and client workspaces.",
            "You must be old enough to form a contract and authorized to bind the business you represent.",
          ],
        },
        {
          title: "Plans, credits, and payment",
          body: [
            "Free Trial and paid plans are described on the Pricing page. Credits are consumed when you generate or use billed features. Unused credits may expire as stated in the product.",
            "Fees are charged in the currency shown at checkout. Taxes may apply. Chargebacks or unpaid invoices may result in suspension.",
          ],
        },
        {
          title: "Connected platforms",
          body: [
            "When you connect Facebook, Instagram, Google, or LinkedIn, you authorize Avonix Social to access Pages and accounts you select and to publish content you submit.",
            "You must have the legal right to manage those Pages and to post the content. You must follow each platform’s terms, including Meta Platform Terms and Google Business Profile policies.",
            "Platforms may revoke access, change APIs, or reject posts. We are not liable for downtime or policy enforcement by Facebook, Instagram, Google, or LinkedIn.",
          ],
        },
        {
          title: "Acceptable use",
          body: [
            "Do not use the service to spam, scrape in violation of law, impersonate others, publish illegal or infringing content, or attempt to break into the platform.",
            "Do not share login credentials. Do not reverse engineer the service except as allowed by law.",
          ],
        },
        {
          title: "Content and intellectual property",
          body: [
            "You retain rights to content you upload or generate for your brand. You grant us a limited license to process that content solely to operate the service (generate, store, schedule, and publish as you request).",
            "Avonix Social software, branding, and documentation remain our property. You may not copy or resell the platform except under a written agency agreement.",
          ],
        },
        {
          title: "AI-generated content",
          body: [
            "Generated drafts may be inaccurate or unsuitable. You must review posts before publishing. You are responsible for the final content that goes live on your Pages.",
          ],
        },
        {
          title: "Availability and changes",
          body: [
            "We aim for high uptime but do not guarantee uninterrupted service. We may change features, plans, or these Terms. Material changes will be reflected by updating the date on this page.",
          ],
        },
        {
          title: "Disclaimers and liability",
          body: [
            "The service is provided “as is”. To the maximum extent permitted by law, we disclaim warranties of merchantability, fitness for a particular purpose, and non-infringement.",
            "Our total liability for claims relating to the service is limited to the fees you paid us in the three months before the claim. We are not liable for lost profits, lost data, or indirect damages.",
          ],
        },
        {
          title: "Termination",
          body: [
            "You may stop using the service and request account deletion at any time. We may suspend or terminate accounts that violate these Terms, fail payment, or create security risk.",
            "After termination, publishing stops. We may delete workspace data as described in the Privacy Policy.",
          ],
        },
        {
          title: "Governing law",
          body: [
            "These Terms are governed by the laws of Bangladesh. Courts in Dhaka have exclusive jurisdiction, except where applicable consumer law says otherwise.",
          ],
        },
        {
          title: "Contact",
          body: [
            "Questions about these Terms: support@avonixsocial.com or https://social.avonixai.com/contact",
          ],
        },
      ]}
    />
  );
}
