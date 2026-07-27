"""
Avonix Social — AI Microservice (Python / FastAPI)
Note: Production keyword analysis runs on the Node API (/api/site/analyze).
This service remains available for optional NLP workloads.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from urllib.parse import urlparse
import httpx

app = FastAPI(title="Avonix Social AI Engine", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SitemapRequest(BaseModel):
    url: str = ""
    domain: str = ""


class GeneratePostRequest(BaseModel):
    primary_keyword: str
    secondary_keywords: list[str] = []
    location: str = ""
    intent: str = "Educational"


def normalize_origin(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    if not raw.startswith("http"):
        raw = "https://" + raw
    parsed = urlparse(raw)
    return f"{parsed.scheme}://{parsed.netloc}"


@app.get("/health")
def health():
    return {"status": "ok", "service": "avonix-social-ai-engine"}


@app.post("/parse-sitemap")
async def parse_sitemap(body: SitemapRequest):
    """Accept root domain or sitemap URL; return keywords (location left for user)."""
    origin = normalize_origin(body.domain or body.url)
    urls: list[str] = []

    if origin:
        candidates = [f"{origin}/sitemap.xml", f"{origin}/sitemap_index.xml"]
        try:
            async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
                for sm in candidates:
                    try:
                        r = await client.get(sm)
                        if r.status_code == 200 and "<loc" in r.text:
                            urls = [
                                loc.split("</loc>")[0]
                                for loc in r.text.split("<loc>")[1:]
                                if "</loc>" in loc
                            ]
                            break
                    except Exception:
                        continue
        except Exception:
            urls = []

    return {
        "success": True,
        "domain": origin,
        "urlCount": len(urls),
        "primaryKeyword": "Enterprise Local SEO Services",
        "secondaryKeywords": [
            "Organic Keyword Ranking",
            "Google Business Profile Optimization",
        ],
        "location": "",
        "address": "",
        "needsLocation": True,
        "sampleUrls": urls[:5],
        "note": "Prefer Node /api/site/analyze for production keyword extraction",
    }


@app.post("/generate-post")
async def generate_post(body: GeneratePostRequest):
    text = (
        f"Strategic search engine optimization helps local businesses capture "
        f"high-intent organic traffic. By focusing on \"{body.primary_keyword}\", "
        f"companies build long-term authority in the {body.location} market.\n\n"
        f"Intent: {body.intent}\n"
        f"#{' #'.join(body.secondary_keywords[:3]) if body.secondary_keywords else body.primary_keyword.replace(' ', '')}"
    )
    return {"success": True, "content": text, "zeroEmoji": True}
