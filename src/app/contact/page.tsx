"use client";

import { useState } from "react";
import { PublicLayout } from "@/components/public/PublicLayout";
import { useToast } from "@/components/ui/Toast";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export default function ContactPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const form = e.currentTarget;
    const data = new FormData(form);

    try {
      const res = await fetch(`${API}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
          company: data.get("company") || undefined,
          phone: data.get("phone") || undefined,
          source: "contact",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to send");
      showToast("Message sent! Our support team will get back to you shortly.", "success");
      form.reset();
    } catch {
      showToast("Could not send message. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      <div className="flex-1 px-4 py-16 max-w-5xl mx-auto text-center sm:text-left animate-fade-in">
        <h1 className="text-3xl font-black text-white mb-2">Get in Touch with Our Team</h1>
        <p className="text-slate-400 text-xs sm:text-sm mb-12">
          Have questions about custom agency integrations or service plans? We are here to help.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="glass-card p-8 rounded-2xl border border-navy-800">
            <h2 className="text-lg font-bold text-white mb-4">Send Us a Direct Message</h2>
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Your Full Name</label>
                <input
                  name="name"
                  type="text"
                  required
                  placeholder="John Doe"
                  className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-300 mb-1">Work Email Address</label>
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="john@agency.com"
                  className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-300 mb-1">Company (optional)</label>
                <input
                  name="company"
                  type="text"
                  placeholder="Agency name"
                  className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-300 mb-1">Phone (optional)</label>
                <input
                  name="phone"
                  type="tel"
                  placeholder="+1 ..."
                  className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-300 mb-1">Message / Inquiry</label>
                <textarea
                  name="message"
                  rows={4}
                  required
                  placeholder="How can our team assist you?"
                  className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg transition-all"
              >
                {loading ? "Sending..." : "Send Message"}
              </button>
            </form>
          </div>

          <div className="space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
            <div className="glass-card p-6 rounded-2xl border border-navy-800">
              <h3 className="font-bold text-white mb-1">Global Support HQ</h3>
              <p className="text-slate-400">House 42, Road 11, Banani, Dhaka-1213, Bangladesh</p>
              <p className="text-slate-400 mt-2">Email: support@avonixsocial.com</p>
            </div>
            <div className="glass-card p-6 rounded-2xl border border-navy-800">
              <h3 className="font-bold text-white mb-1">Response Time</h3>
              <p className="text-slate-400">
                Our support team responds to inquiries within 2 business hours.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
