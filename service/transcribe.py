"""
Speech to text for the script signal.

Tries local Whisper first (offline, multilingual, no API). If it is not
installed the app keeps working — you type the transcript instead. The demo
must never die because a model file did not download.

    pip install openai-whisper        # then the model downloads on first use

Model sizes: "tiny" ~75 MB, "base" ~150 MB, "small" ~500 MB.
Download one BEFORE the hackathon. Wifi at these venues is not your friend.
"""
import os
import tempfile

_model = None
_load_error = None

MODEL_SIZE = os.getenv("WHISPER_MODEL", "base")


def available() -> bool:
    try:
        import whisper  # noqa: F401
        return True
    except ImportError:
        return False


def _get_model():
    global _model, _load_error
    if _model is not None or _load_error:
        return _model
    try:
        import whisper
        _model = whisper.load_model(MODEL_SIZE)
    except Exception as e:
        _load_error = str(e)
    return _model


def transcribe(path: str, language: str | None = None) -> dict:
    """
    Returns {"text", "language", "engine"}.
    language=None lets Whisper detect it — leave it that way for Indian calls,
    which switch between Hindi and English mid-sentence.
    """
    if not available():
        return {"text": "", "language": "unknown",
                "engine": "unavailable (pip install openai-whisper)"}

    m = _get_model()
    if m is None:
        return {"text": "", "language": "unknown",
                "engine": f"load failed: {_load_error}"}

    try:
        r = m.transcribe(path, language=language, fp16=False)
        return {"text": r.get("text", "").strip(),
                "language": r.get("language", "unknown"),
                "engine": f"whisper-{MODEL_SIZE}"}
    except Exception as e:
        return {"text": "", "language": "unknown",
                "engine": f"error: {type(e).__name__}: {e}"}


def transcribe_bytes(data: bytes, suffix: str = ".wav", language: str | None = None) -> dict:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        p = f.name
    try:
        return transcribe(p, language)
    finally:
        try:
            os.unlink(p)
        except OSError:
            pass
