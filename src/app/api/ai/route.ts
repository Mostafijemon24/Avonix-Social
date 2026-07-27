import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy route to Python FastAPI AI Engine
 * Architecture: Next.js → Python (Sitemap Parser, NLP, Gemini)
 */
export async function POST(request: NextRequest) {
  const aiUrl = process.env.AI_ENGINE_URL || "http://localhost:8001";

  try {
    const body = await request.json();
    const endpoint = request.nextUrl.searchParams.get("endpoint") || "/parse-sitemap";

    const res = await fetch(`${aiUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        error: "AI engine unavailable. Start with: npm run dev:ai",
        fallback: {
          primaryKeyword: "Enterprise Local SEO Services",
          secondaryKeywords: [
            "Organic Keyword Ranking",
            "Google Business Profile Optimization",
          ],
          location: "Manhattan, New York, USA",
        },
      },
      { status: 503 }
    );
  }
}
