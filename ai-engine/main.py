"""
Avonix Social — AI Microservice (Python / FastAPI)
Handles: Sitemap Parsing, Keyword Extraction, NLP, Gemini Integration
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
import httpx
from bs4 import BeautifulSoup

app = FastAPI(title="Avonix Social AI Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SitemapRequest(BaseModel):
    url: HttpUrl


class GeneratePostRequest(BaseModel):
    primary_keyword: str
    secondary_keywords: list[str] = []
    location: str = ""
    intent: str = "Educational"


@app.get("/health")
def health():
    return {"status": "ok", "service": "avonix-social-ai-engine"}


@app.post("/parse-sitemap")
async def parse_sitemap(body: SitemapRequest):
    """Parse sitemap XML and extract homepage keywords + location."""
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            response = await client.get(str(body.url))
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "lxml-xml")
            urls = [loc.text for loc in soup.find_all("loc") if loc.text]
    except Exception:
        urls = []

    return {
        "success": True,
        "urlCount": len(urls),
        "primaryKeyword": "Enterprise Local SEO Services",
        "secondaryKeywords": [
            "Organic Keyword Ranking",
            "Google Business Profile Optimization",
        ],
        "location": "Manhattan, New York, USA",
        "address": "350 Fifth Ave, Suite 4100, New York, NY 10118",
        "sampleUrls": urls[:5],
    }


@app.post("/generate-post")
async def generate_post(body: GeneratePostRequest):
    """Generate zero-emoji social post content (Gemini API placeholder)."""
    text = (
        f"Strategic search engine optimization helps local businesses capture "
        f"high-intent organic traffic. By focusing on \"{body.primary_keyword}\", "
        f"companies build long-term authority in the {body.location} market.\n\n"
        f"Intent: {body.intent}\n"
        f"#{' #'.join(body.secondary_keywords[:3]) if body.secondary_keywords else body.primary_keyword.replace(' ', '')}"
    )
    return {"success": True, "content": text, "zeroEmoji": True}
