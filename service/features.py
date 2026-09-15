"""
Acoustic features for synthetic-speech detection.

Design choice worth defending in the pitch: every feature here has a plain
English meaning. A deep model would score a couple of points higher on a
benchmark and tell a judge nothing. This one can say *why* it flagged a call,
which is the whole point of the project.

Each feature targets a known way that synthesised speech differs from a real
person talking into a phone.
"""
import numpy as np
import librosa

SR = 16000

# name -> one-line explanation, shown to the user when a feature drives a flag
EXPLANATIONS = {
    "breath_ratio":      "no breath sounds between phrases",
    "silence_ratio":     "unnaturally little silence in the speech",
    "pitch_std":         "pitch is unnaturally steady",
    "pitch_jitter":      "pitch changes too smoothly between frames",
    "pitch_voiced_frac": "voicing pattern does not match natural speech",
    "hf_rolloff_mean":   "high frequencies cut off abruptly",
    "hf_energy_ratio":   "very little energy above 4 kHz",
    "spectral_flatness": "spectrum is unusually flat, like synthesis noise",
    "spectral_centroid": "brightness sits outside the natural range",
    "spectral_bw":       "spectral spread is narrower than real speech",
    "zcr_std":           "zero-crossing pattern is too regular",
    "rms_std":           "loudness is too consistent across the clip",
    "rms_dr":            "dynamic range is compressed",
    "mfcc_var_mean":     "cepstral variation is lower than natural speech",
    "delta_mfcc_mean":   "frame-to-frame change is unnaturally smooth",
    "reverb_proxy":      "no room acoustics — sounds recorded nowhere",
    "onset_rate":        "syllable onsets are too evenly spaced",
    "hnr_proxy":         "harmonic-to-noise ratio is too clean",
}

FEATURE_NAMES = list(EXPLANATIONS.keys())


def _safe(x, default=0.0):
    x = float(x)
    return default if not np.isfinite(x) else x


def extract(y: np.ndarray, sr: int = SR) -> dict:
    """Return the feature dict for one mono waveform."""
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        sr = SR
    y = librosa.util.normalize(y.astype(np.float32))

    hop = 256
    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=hop))
    rms = librosa.feature.rms(S=S, frame_length=1024, hop_length=hop)[0]
    f = {}

    # --- energy / pausing -------------------------------------------------
    thr = np.percentile(rms, 30)
    quiet = rms < thr
    f["silence_ratio"] = _safe(quiet.mean())

    # breaths are low-energy but broadband; pure silence is not
    flat = librosa.feature.spectral_flatness(S=S)[0]
    f["breath_ratio"] = _safe((quiet & (flat > np.percentile(flat, 60))).mean())

    f["rms_std"] = _safe(np.std(rms))
    f["rms_dr"] = _safe(np.percentile(rms, 95) - np.percentile(rms, 5))

    # --- pitch ------------------------------------------------------------
    try:
        f0, voiced, _ = librosa.pyin(y, fmin=60, fmax=400, sr=sr,
                                     frame_length=1024, hop_length=hop)
        v = f0[~np.isnan(f0)]
        f["pitch_std"] = _safe(np.std(v)) if v.size > 2 else 0.0
        f["pitch_jitter"] = _safe(np.mean(np.abs(np.diff(v)))) if v.size > 2 else 0.0
        f["pitch_voiced_frac"] = _safe(np.mean(voiced))
    except Exception:
        f["pitch_std"] = f["pitch_jitter"] = f["pitch_voiced_frac"] = 0.0

    # --- spectrum ---------------------------------------------------------
    f["spectral_flatness"] = _safe(np.mean(flat))
    f["spectral_centroid"] = _safe(np.mean(librosa.feature.spectral_centroid(S=S, sr=sr)))
    f["spectral_bw"] = _safe(np.mean(librosa.feature.spectral_bandwidth(S=S, sr=sr)))
    roll = librosa.feature.spectral_rolloff(S=S, sr=sr, roll_percent=0.95)[0]
    f["hf_rolloff_mean"] = _safe(np.mean(roll))

    freqs = librosa.fft_frequencies(sr=sr, n_fft=1024)
    hi = S[freqs > 4000].sum()
    f["hf_energy_ratio"] = _safe(hi / (S.sum() + 1e-9))

    zcr = librosa.feature.zero_crossing_rate(y, hop_length=hop)[0]
    f["zcr_std"] = _safe(np.std(zcr))

    # --- cepstral ---------------------------------------------------------
    mfcc = librosa.feature.mfcc(S=librosa.power_to_db(S ** 2), n_mfcc=20, sr=sr)
    f["mfcc_var_mean"] = _safe(np.mean(np.var(mfcc, axis=1)))
    f["delta_mfcc_mean"] = _safe(np.mean(np.abs(librosa.feature.delta(mfcc))))

    # --- room / voice quality --------------------------------------------
    # real rooms smear energy after an onset; TTS output usually does not
    env = librosa.onset.onset_strength(S=librosa.power_to_db(S ** 2), sr=sr, hop_length=hop)
    f["reverb_proxy"] = _safe(np.mean(env[1:] / (env[:-1] + 1e-6))) if env.size > 2 else 0.0
    onsets = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop)
    f["onset_rate"] = _safe(len(onsets) / (len(y) / sr + 1e-9))

    harm = librosa.effects.harmonic(y)
    f["hnr_proxy"] = _safe(np.sum(harm ** 2) / (np.sum((y - harm) ** 2) + 1e-9))

    return {k: f.get(k, 0.0) for k in FEATURE_NAMES}


def extract_file(path: str) -> dict:
    y, sr = librosa.load(path, sr=SR, mono=True)
    return extract(y, sr)


def to_vector(feats: dict) -> np.ndarray:
    return np.array([feats[k] for k in FEATURE_NAMES], dtype=np.float32)
