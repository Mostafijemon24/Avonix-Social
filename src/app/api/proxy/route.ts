import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy route to Node.js Primary API Server
 * Architecture: Next.js → Node.js (Auth, Billing, Dispatches)
 */
export async function POST(request: NextRequest) {
  const apiUrl = process.env.API_SERVER_URL || "http://localhost:4000";

  try {
    const body = await request.json();
    const path = request.nextUrl.searchParams.get("path") || "/";

    const res = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "API server unavailable. Start backend with: npm run dev:api" },
      { status: 503 }
    );
  }
}

export async function GET(request: NextRequest) {
  const apiUrl = process.env.API_SERVER_URL || "http://localhost:4000";
  const path = request.nextUrl.searchParams.get("path") || "/health";

  try {
    const res = await fetch(`${apiUrl}${path}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ status: "offline" }, { status: 503 });
  }
}
