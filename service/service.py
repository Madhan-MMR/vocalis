"""
Vocalis analysis service.

The Node/Express backend owns contacts, call history and the UI. This owns
the audio. Keeping them separate means the Python ML stack never has to live
inside the web app, and either side can be restarted without the other.

    pip install fastapi uvicorn python-multipart librosa scikit-learn soundfile joblib
    uvicorn service:app --port 8000 --reload

Endpoints
    GET  /health
    POST /embed     audio                        -> speaker embedding
    POST /enrol     audio (repeatable)           -> averaged profile
    POST /analyse   audio + profiles + context   -> full five-layer verdict
"""
import json
import tempfile
from pathlib import Path
from typing import List, Optional

import numpy as np
import librosa
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import script_scorer
import speaker
import verdict as V
from detect import Detector

app = FastAPI(title="Vocalis analysis service", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

SR = 16000
_det = None
_det_err = None


def detector():
    """Lazy load so the service still starts (degraded) with no model file."""
    global _det, _det_err
    if _det is None and _det_err is None:
        try:
            _det = Detector("model.joblib")
        except Exception as e:
            _det_err = str(e)
    return _det


async def load_audio(f: UploadFile) -> np.ndarray:
    data = await f.read()
    suffix = Path(f.filename or "a.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as t:
        t.write(data)
        p = t.name
    y, _ = librosa.load(p, sr=SR, mono=True)
    return y, p


@app.get("/health")
def health():
    d = detector()
    return {"ok": True,
            "synthesis_model": bool(d),
            "model_error": _det_err,
            "metrics": d.metrics if d else {},
            "embedding_dim": speaker.DIM,
            "capabilities": {
                "acoustic_spectral": True,
                "prosody_rhythm": True,
                "explainable_features": True,
                "dynamic_risk_scoring": True,
                "deepfake_transformer": False,
                "deepfake_transformer_note": "Install a wav2vec2/AASIST checkpoint and adapter before enabling.",
                "in_memory_audio": True,
                "raw_audio_persistence": False,
                "supported_languages": ["en-IN", "hi-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN", "kn-IN"],
            },
            "layers": ["synthesis", "identity", "script", "context", "challenge"]}


@app.post("/embed")
async def embed(audio: UploadFile = File(...)):
    y, _ = await load_audio(audio)
    if len(y) < SR * 0.7:
        return JSONResponse({"error": "Need at least one second of speech."}, 400)
    return {"vector": speaker.embed(y).tolist(), "dim": speaker.DIM,
            "duration_s": round(len(y) / SR, 2)}


@app.post("/enrol")
async def enrol(audio: List[UploadFile] = File(...)):
    """Three short clips beat one long one — averaging cancels session noise."""
    clips = []
    for f in audio:
        y, _ = await load_audio(f)
        if len(y) >= SR * 0.7:
            clips.append(y)
    if not clips:
        return JSONResponse({"error": "No clip was long enough. Speak for at least a second."}, 400)
    try:
        prof = speaker.enrol(clips)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, 400)
    prof["quality"] = ("good" if prof["n_clips"] >= 3 and prof["spread"] < 0.05
                       else "fair" if prof["n_clips"] >= 2 else "weak")
    if prof["quality"] != "good":
        prof["hint"] = "Record at least three clips for a reliable profile."
    return prof


@app.post("/analyse")
async def analyse(
    audio: Optional[UploadFile] = File(None),
    transcript: str = Form(""),
    profiles: str = Form("[]"),          # JSON [{contact_id,name,phone,vector}]
    context: str = Form("{}"),           # JSON of CallContext fields
    challenge_result: str = Form("not_asked"),
    threshold: float = Form(0.82),
):
    # ---------- layer 1: synthesis ----------
    synthesis = {"score": 0.0, "reasons": [], "band": "low", "n_windows": 0,
                 "available": False}
    identity = {"matched": False, "best": None, "ranked": []}

    audio_error = None
    if audio is not None:
        try:
            y, path = await load_audio(audio)
        except Exception as e:
            audio_error = f"Audio could not be decoded: {e}"
            y = None
            path = None
    if audio is not None and y is not None:
        d = detector()
        if d:
            synthesis = d.score_clip(path)
            synthesis["available"] = True
        else:
            synthesis["note"] = f"synthesis model unavailable: {_det_err}"

        # ---------- layer 2: identity ----------
        try:
            profs = json.loads(profiles) or []
        except json.JSONDecodeError:
            profs = []
        if profs:
            identity = speaker.match(speaker.embed(y), profs, threshold)
    elif audio_error:
        synthesis["note"] = audio_error

    # ---------- layer 3: script ----------
    script = script_scorer.score(transcript)

    # ---------- layer 4: context ----------
    try:
        cd = json.loads(context) or {}
    except json.JSONDecodeError:
        cd = {}
    ctx = V.CallContext(**{k: bool(cd.get(k, False))
                           for k in V.CallContext.__dataclass_fields__})

    # ---------- layers 1x2 matrix + 5 ----------
    v = V.decide(synthesis, identity, script, ctx, challenge_result)

    return {"verdict": {
                "risk": v.risk, "band": v.band, "headline": v.headline,
                "cell": v.cell, "cell_label": v.cell_label,
                "cell_detail": v.cell_detail, "layers": v.layers,
                "reasons": v.reasons, "actions": v.actions,
                "challenge": v.challenge},
            "synthesis": {k: synthesis.get(k) for k in
                          ("score", "band", "reasons", "n_windows",
                           "duration_s", "window_scores", "available")},
            "identity": identity,
            "script": script}


@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...),
                           language: Optional[str] = Form(None)):
    """
    The private transcription path.

    The browser Speech API is faster but ships audio to a cloud service, which
    contradicts the on-device claim. This runs Whisper locally: slower, but
    nothing leaves the machine and it works with no internet. Leave `language`
    empty for Indian calls, which switch between Hindi and English mid-sentence.
    """
    import transcribe as tr
    if not tr.available():
        return JSONResponse(
            {"error": "Whisper is not installed on the service.",
             "hint": "pip install openai-whisper, and make sure ffmpeg is on PATH."},
            503)
    data = await audio.read()
    suffix = Path(audio.filename or "a.wav").suffix or ".wav"
    out = tr.transcribe_bytes(data, suffix, language or None)
    if not out.get("text") and out.get("engine", "").startswith(("error", "load")):
        return JSONResponse({"error": out["engine"]}, 502)
    return out


@app.post("/challenge/hash")
async def challenge_hash(answer: str = Form(...), salt: str = Form(...)):
    """
    Node calls this when the user sets up a security question. Answers are
    stored hashed — a challenge bank in the clear is a list of exactly the
    facts an attacker needs.
    """
    return {"hash": V.hash_answer(answer, salt)}


@app.post("/challenge/verify")
async def challenge_verify(given: str = Form(...), stored_hash: str = Form(...),
                           salt: str = Form(...)):
    return {"passed": V.check_answer(given, stored_hash, salt)}
