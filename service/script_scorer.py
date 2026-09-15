"""
Signal 2 — the fraud script.

This is the part no commercial detector does. Pindrop and Hiya answer "is the
voice fake". They cannot answer "is this person running the grandparent scam
on me in Marathi".

A synthetic voice on its own is ambiguous — it could be an IVR, a podcast
playing in the background, an accessibility device. A synthetic voice *plus*
urgency plus secrecy plus a payment demand is not ambiguous at all.

Works with an LLM when a key is set, and falls back to multilingual keyword
rules so the demo never dies on a flaky network.
"""
import json
import os
import re

MODEL = "claude-sonnet-4-6"

TACTICS = ["urgency", "secrecy", "authority", "payment_demand",
           "isolation", "emotional_distress", "verification_avoidance"]

SYSTEM = """You analyse a transcript of a live phone call and judge whether the
caller is running a social-engineering fraud script.

Score each tactic 0-1:
- urgency: pressure to act immediately, no time to think
- secrecy: telling the person not to discuss this with anyone
- authority: claiming to be police, bank, tax officer, senior official
- payment_demand: asking for money, UPI, transfer, gift cards, codes
- isolation: keeping them on the line, stopping them consulting others
- emotional_distress: manufactured crisis, accident, arrest, hospital
- verification_avoidance: resisting a callback or independent check

The transcript may be in Hindi, Marathi, Tamil, Telugu, Bengali, English or a
mix. Judge meaning, not keywords.

Return ONLY minified JSON:
{"scores":{...},"risk":0.0,"summary":"one short sentence","language":"detected language"}
No markdown, no preamble."""

# fallback cues — deliberately multilingual, deliberately crude
CUES = {
    "urgency": ["right now", "immediately", "hurry", "abhi", "turant", "jaldi",
                "lavkar", "udane", "before it's too late", "last chance"],
    "secrecy": ["don't tell", "do not tell", "between us", "kisi ko mat batana",
                "secret", "confidential", "koni sangu naka"],
    "authority": ["police", "cbi", "income tax", "customs", "bank manager",
                  "trai", "officer", "court", "warrant", "adalat"],
    "payment_demand": ["transfer", "upi", "paytm", "gpay", "account number",
                       "send money", "paise", "rupees", "gift card", "otp",
                       "paise bhejo", "amount"],
    "isolation": ["stay on the line", "don't hang up", "phone mat kaato",
                  "do not disconnect", "keep talking to me"],
    "emotional_distress": ["accident", "hospital", "arrested", "jail", "trouble",
                           "emergency", "musibat", "haadsa", "gir gaya"],
    "verification_avoidance": ["no time to verify", "don't call back", "trust me",
                               "why are you asking", "mat poocho"],
}


def _fallback(transcript: str) -> dict:
    t = transcript.lower()
    scores = {}
    for tac, words in CUES.items():
        hits = sum(1 for w in words if w in t)
        scores[tac] = min(1.0, hits / 2.0)
    hit_names = [k for k, v in scores.items() if v > 0]
    risk = min(1.0, sum(scores.values()) / 3.0)
    return {"scores": scores, "risk": round(risk, 3),
            "summary": ("Detected " + ", ".join(hit_names).replace("_", " ")
                        if hit_names else "No fraud-script pattern detected"),
            "language": "unknown", "engine": "keyword-fallback"}


def score(transcript: str) -> dict:
    """Return tactic scores and an overall 0-1 script risk."""
    if not transcript or not transcript.strip():
        return {"scores": {t: 0.0 for t in TACTICS}, "risk": 0.0,
                "summary": "No speech to analyse", "language": "unknown",
                "engine": "none"}

    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return _fallback(transcript)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=key)
        msg = client.messages.create(
            model=MODEL, max_tokens=400, system=SYSTEM,
            messages=[{"role": "user", "content": transcript[:4000]}])
        raw = "".join(b.text for b in msg.content if b.type == "text")
        raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
        out = json.loads(raw)
        out.setdefault("scores", {})
        for t in TACTICS:
            out["scores"].setdefault(t, 0.0)
        out["risk"] = float(out.get("risk", 0.0))
        out["engine"] = MODEL
        return out
    except Exception as e:
        out = _fallback(transcript)
        out["engine"] = f"keyword-fallback ({type(e).__name__})"
        return out
