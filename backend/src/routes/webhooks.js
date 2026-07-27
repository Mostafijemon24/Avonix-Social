import { Router } from "express";
import { renewSubscription, subscribeUser } from "../services/userService.js";
import prisma from "../db.js";

const router = Router();

/**
 * Stripe Webhook — monthly renewal on invoice.payment_succeeded
 * Set STRIPE_WEBHOOK_SECRET in .env for production signature verification
 */
router.post("/stripe", async (req, res) => {
  const event = req.body;

  try {
    if (event.type === "invoice.payment_succeeded") {
      const customerEmail = event.data?.object?.customer_email;
      const subId = event.data?.object?.subscription;

      if (customerEmail) {
        const user = await prisma.user.findUnique({ where: { email: customerEmail } });
        if (user) {
          await renewSubscription(user.id);
        }
      }

      return res.json({ received: true, action: "credits_renewed", email: customerEmail, subId });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data?.object;
      const email = session.customer_email || session.metadata?.email;
      const planSlug = session.metadata?.planSlug || "pro";

      if (email) {
        await subscribeUser({
          email,
          planSlug,
          gateway: "stripe",
          gatewaySubId: session.subscription,
        });
      }

      return res.json({ received: true, action: "subscription_activated", email });
    }

    res.json({ received: true, action: "ignored" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PayPal Webhook — subscription renewed
 */
router.post("/paypal", async (req, res) => {
  const event = req.body;

  try {
    if (event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED" || event.event_type === "PAYMENT.SALE.COMPLETED") {
      const email = event.resource?.subscriber?.email_address || event.resource?.custom;
      const planSlug = event.resource?.plan_id?.includes("agency") ? "agency" : "pro";

      if (email) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user && event.event_type === "PAYMENT.SALE.COMPLETED") {
          await renewSubscription(user.id);
        } else if (email) {
          await subscribeUser({ email, planSlug, gateway: "paypal", gatewaySubId: event.resource?.id });
        }
      }

      return res.json({ received: true, action: "paypal_processed" });
    }

    res.json({ received: true, action: "ignored" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
