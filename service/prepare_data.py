"""
Turn an ASVspoof download into the data/real and data/fake layout train.py wants.

ASVspoof ships audio in one flat folder plus a protocol .txt whose last column
is 'bonafide' or 'spoof'. Sorting that by hand is an hour you do not have.

ASVspoof 2019/2021 LA protocol line looks like:
    LA_0079 LA_T_1138215 - - bonafide

Usage:
    python prepare_data.py \
        --audio  path/to/ASVspoof2019_LA_train/flac \
        --protocol path/to/ASVspoof2019.LA.cm.train.trn.txt \
        --out data --per-class 2000

--per-class keeps it balanced and keeps feature extraction under an hour.
Copies by default; pass --link to symlink instead and save disk.
"""
import argparse
import os
import random
import shutil
from pathlib import Path

AUDIO_EXT = [".flac", ".wav"]


def parse_protocol(path: Path) -> dict:
    """file id -> 'bonafide' | 'spoof'"""
    labels = {}
    for line in path.read_text(errors="ignore").splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        tag = parts[-1].lower()
        if tag in ("bonafide", "spoof"):
            # the file id is the token that looks like LA_T_1138215
            fid = next((p for p in parts if p.startswith("LA_") and p.count("_") >= 2),
                       parts[1])
            labels[fid] = tag
    return labels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--protocol", required=True)
    ap.add_argument("--out", default="data")
    ap.add_argument("--per-class", type=int, default=2000)
    ap.add_argument("--link", action="store_true", help="symlink instead of copy")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()

    audio_dir, proto = Path(a.audio), Path(a.protocol)
    if not audio_dir.is_dir():
        print(f"No such folder: {audio_dir}")
        return 1
    if not proto.is_file():
        print(f"No such protocol file: {proto}")
        return 1

    labels = parse_protocol(proto)
    if not labels:
        print("Parsed zero labels — is that really the protocol .txt?")
        return 1
    print(f"{len(labels)} labels in protocol")

    # index the audio folder once
    index = {}
    for p in audio_dir.rglob("*"):
        if p.suffix.lower() in AUDIO_EXT:
            index[p.stem] = p
    print(f"{len(index)} audio files found")

    buckets = {"bonafide": [], "spoof": []}
    for fid, tag in labels.items():
        p = index.get(fid)
        if p:
            buckets[tag].append(p)

    print(f"matched  bonafide {len(buckets['bonafide'])}  spoof {len(buckets['spoof'])}")
    if not buckets["bonafide"] or not buckets["spoof"]:
        print("One class is empty — check that --audio points at the flac folder.")
        return 1

    random.seed(a.seed)
    out = Path(a.out)
    for tag, sub in (("bonafide", "real"), ("spoof", "fake")):
        dest = out / sub
        dest.mkdir(parents=True, exist_ok=True)
        files = buckets[tag]
        random.shuffle(files)
        files = files[:a.per_class] if a.per_class else files
        for p in files:
            target = dest / p.name
            if target.exists():
                continue
            if a.link:
                os.symlink(p.resolve(), target)
            else:
                shutil.copy2(p, target)
        print(f"  {dest}: {len(files)} files")

    print(f"\nNow run:\n  python train.py --data {out} --codec-aug")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
