"""
Train the synthetic-speech classifier.

Expects two folders of audio:

    data/
      real/   *.wav | *.flac   genuine human speech
      fake/   *.wav | *.flac   TTS / voice-cloned speech

For ASVspoof LA, split the flac files using the protocol file's bonafide /
spoof label into those two folders. A few thousand clips each is plenty for
a hackathon demo.

    python train.py --data data --codec-aug

--codec-aug simulates Indian phone audio (8 kHz band limiting) on half the
training clips so the model does not fall apart on a real call. This is the
single most important flag here: models trained on clean studio audio score
well on paper and fail on an actual phone.
"""
import argparse
import json
import sys
from pathlib import Path

import joblib
import librosa
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, classification_report, confusion_matrix

from features import extract, to_vector, FEATURE_NAMES, SR

AUDIO_EXT = {".wav", ".flac", ".mp3", ".m4a", ".ogg"}


def phone_codec(y, sr=SR):
    """Crude but effective stand-in for narrowband telephony."""
    y = librosa.resample(y, orig_sr=sr, target_sr=8000)
    y = librosa.resample(y, orig_sr=8000, target_sr=sr)
    y = np.clip(y * 1.6, -1.0, 1.0)                       # mild companding
    return y + np.random.normal(0, 0.002, len(y)).astype(np.float32)


def load_folder(folder: Path, label: int, codec_aug: bool, limit: int,
                boost_tag: str = "", boost_times: int = 1):
    """
    boost_tag: clips whose filename starts with this are repeated boost_times.

    Why this exists: a handful of clips recorded through your demo laptop's
    browser will be drowned out by thousands of studio clips from ASVspoof.
    The model then never learns what your actual demo channel sounds like and
    flags your own voice as synthetic. Repeating them fixes the imbalance
    without you having to record hundreds.
    """
    files = [p for p in sorted(folder.rglob("*")) if p.suffix.lower() in AUDIO_EXT]
    boosted = [p for p in files if boost_tag and p.name.startswith(boost_tag)]
    rest = [p for p in files if p not in boosted]
    if limit:
        rest = rest[:limit]
    files = rest + boosted * max(1, boost_times)
    if boosted:
        print(f"  {folder.name}: {len(rest)} base + "
              f"{len(boosted)} demo-channel x{boost_times}")
    X, y_ = [], []
    for i, p in enumerate(files, 1):
        try:
            sig, _ = librosa.load(p, sr=SR, mono=True)
            if len(sig) < SR * 0.5:
                continue
            sig = sig[:SR * 6]                            # cap at 6 s
            X.append(to_vector(extract(sig)))
            y_.append(label)
            if codec_aug and i % 2 == 0:
                X.append(to_vector(extract(phone_codec(sig))))
                y_.append(label)
        except Exception as e:
            print(f"  skipped {p.name}: {e}", file=sys.stderr)
        if i % 100 == 0:
            print(f"  {folder.name}: {i}/{len(files)}", flush=True)
    return X, y_


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
    ap.add_argument("--out", default="model.joblib")
    ap.add_argument("--codec-aug", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="clips per class, 0 = all")
    ap.add_argument("--boost", default="demo_",
                    help="filename prefix of demo-channel clips to repeat")
    ap.add_argument("--boost-times", type=int, default=25,
                    help="how many times to repeat each demo-channel clip")
    a = ap.parse_args()

    root = Path(a.data)
    real, fake = root / "real", root / "fake"
    if not real.is_dir() or not fake.is_dir():
        print(f"Need {real} and {fake}. See the docstring for the layout.")
        return 1

    print("Extracting features (this is the slow part)...")
    Xr, yr = load_folder(real, 0, a.codec_aug, a.limit, a.boost, a.boost_times)
    Xf, yf = load_folder(fake, 1, a.codec_aug, a.limit, a.boost, a.boost_times)
    if not Xr or not Xf:
        print("One of the classes is empty — check your folders.")
        return 1

    X = np.vstack(Xr + Xf)
    y = np.array(yr + yf)
    print(f"\n{len(y)} clips  |  genuine {int((y==0).sum())}  synthetic {int((y==1).sum())}")

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

    base = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08,
                                          max_leaf_nodes=31, random_state=42)
    # calibration matters: an uncalibrated confidence shown to a scared user is a lie
    clf = CalibratedClassifierCV(base, method="isotonic", cv=3)
    clf.fit(Xtr, ytr)

    prob = clf.predict_proba(Xte)[:, 1]
    pred = (prob >= 0.5).astype(int)
    auc = roc_auc_score(yte, prob)

    # equal error rate — the number ASVspoof papers report
    from sklearn.metrics import roc_curve
    fpr, tpr, _ = roc_curve(yte, prob)
    eer = fpr[np.nanargmin(np.abs((1 - tpr) - fpr))]

    print(f"\nAUC {auc:.4f}   EER {eer*100:.2f}%")
    print(classification_report(yte, pred, target_names=["genuine", "synthetic"]))
    print("confusion matrix (rows = true):")
    print(confusion_matrix(yte, pred))

    # permutation importance gives us the per-feature story for the UI
    from sklearn.inspection import permutation_importance
    imp = permutation_importance(clf, Xte, yte, n_repeats=5, random_state=42)
    order = np.argsort(imp.importances_mean)[::-1]
    print("\nmost useful features:")
    for i in order[:8]:
        print(f"  {FEATURE_NAMES[i]:<20} {imp.importances_mean[i]:.4f}")

    joblib.dump({"model": clf,
                 "features": FEATURE_NAMES,
                 "importance": imp.importances_mean.tolist(),
                 "train_mean": X.mean(axis=0).tolist(),
                 "train_std": (X.std(axis=0) + 1e-9).tolist(),
                 "metrics": {"auc": float(auc), "eer": float(eer)}}, a.out)
    print(f"\nsaved {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
