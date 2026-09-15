"""
Score audio for synthetic speech and say why.

The 'why' is not decoration. A bare 94% means nothing to a frightened person
and nothing to a police report. Naming the artifact is what makes the output
usable evidence.
"""
from pathlib import Path

import joblib
import librosa
import numpy as np

from features import extract, to_vector, FEATURE_NAMES, EXPLANATIONS, SR

WINDOW_S = 2.0
HOP_S = 1.0


class Detector:
    def __init__(self, model_path="model.joblib"):
        p = Path(model_path)
        if not p.exists():
            raise FileNotFoundError(
                f"{model_path} not found. Run train.py first, or use --demo mode.")
        b = joblib.load(p)
        self.clf = b["model"]
        self.names = b["features"]
        self.imp = np.array(b["importance"])
        self.mean = np.array(b["train_mean"])
        self.std = np.array(b["train_std"])
        self.metrics = b.get("metrics", {})

    # ---------- single window ----------

    def score_window(self, y, sr=SR):
        feats = extract(y, sr)
        vec = to_vector(feats)
        prob = float(self.clf.predict_proba(vec.reshape(1, -1))[0, 1])
        return prob, feats, vec

    def reasons(self, vec, top_k=3):
        """Which features are both unusual for this clip and useful in general."""
        z = np.abs((vec - self.mean) / self.std)
        contribution = z * self.imp
        out = []
        for i in np.argsort(contribution)[::-1][:top_k]:
            if contribution[i] <= 0:
                continue
            out.append({"feature": self.names[i],
                        "reason": EXPLANATIONS.get(self.names[i], self.names[i]),
                        "weight": float(contribution[i])})
        return out

    # ---------- whole clip ----------

    def score_clip(self, path_or_array, sr=None):
        if isinstance(path_or_array, (str, Path)):
            y, sr = librosa.load(str(path_or_array), sr=SR, mono=True)
        else:
            y = path_or_array
            if sr and sr != SR:
                y = librosa.resample(y, orig_sr=sr, target_sr=SR)
            sr = SR

        win, hop = int(WINDOW_S * SR), int(HOP_S * SR)
        probs, vecs = [], []
        for start in range(0, max(1, len(y) - win + 1), hop):
            chunk = y[start:start + win]
            if len(chunk) < win * 0.6:
                break
            p, _, v = self.score_window(chunk, sr)
            probs.append(p)
            vecs.append(v)

        if not probs:                                   # clip shorter than a window
            p, _, v = self.score_window(y, sr)
            probs, vecs = [p], [v]

        probs = np.array(probs)
        # rolling vote: a single odd window should not trigger an accusation
        score = float(np.median(probs))
        worst = int(np.argmax(probs))

        return {"score": score,
                "band": band(score),
                "window_scores": probs.tolist(),
                "reasons": self.reasons(vecs[worst]),
                "n_windows": len(probs),
                "duration_s": round(len(y) / SR, 2)}


def band(p: float) -> str:
    """Bands, not a binary verdict. The human makes the call."""
    if p >= 0.80:
        return "high"
    if p >= 0.55:
        return "elevated"
    if p >= 0.35:
        return "unclear"
    return "low"


BAND_TEXT = {
    "high":     "Likely a synthetic voice",
    "elevated": "Possibly synthetic — verify before acting",
    "unclear":  "Not enough evidence either way",
    "low":      "No sign of synthesis",
}
