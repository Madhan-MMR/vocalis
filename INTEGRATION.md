# Vocalis — five-layer voice fraud shield

Merge of the Vocalis full-stack app (React + Express + MongoDB) with the
PratiDhwani detection engine. The web app keeps its UI, contacts and call
history; a Python service takes over the audio.

## Why five layers

Every layer here is beatable on its own. Beating all five at once is a
different problem.

| # | Layer | Question | Beaten by |
|---|---|---|---|
| 1 | Synthesis | Is the voice machine-made? | a brand-new cloning tool |
| 2 | Identity | Is it who the number claims? | a good clone (matches by design) |
| 3 | Script | Is this the fraud playbook? | a patient caller |
| 4 | Context | Is the caller suspicious? | a spoofed number |
| 5 | Challenge | Can they answer a family fact? | only someone who knows it |

### The contribution: layer 1 crossed with layer 2

|                     | Sounds human | Sounds synthetic |
|---------------------|--------------|------------------|
| **Voice matches a contact** | genuine call | **cloned voice of someone you know** |
| **No match**                | unknown person | machine voice, unknown |

The top-right cell is the actual attack. Neither system finds it alone: the
identity matcher says "yes, that is your son", the synthesis detector says
"but that voice was generated". Only together do they say *someone has cloned
your son's voice*.

### Layer 5 is the one that does not lose the arms race

Every acoustic method degrades as cloning improves. A challenge does not.
"What did we eat at Meera's wedding" cannot be answered by a voice model, no
matter how good it sounds. Answers are stored HMAC-hashed with a per-challenge
salt — a challenge bank in plain text is a list of exactly the facts an
attacker needs.

A passed challenge caps risk at 20%. A failed one floors it at 90%.

## What changed from the original

| Original | Now |
|---|---|
| 4-number fingerprint (energy, centroid, crossings, voicedRatio) | 57-dim MFCC-statistics embedding |
| hardcoded match threshold 68 | tunable threshold, default 0.82, cosine-based |
| identity matching only | five layers plus the matrix |
| no explainability | named artifacts persisted on every call record |

The four original numbers measure the microphone, not the speaker: two
different people at the same loudness match, and the same person speaking
quietly does not.

**The embedding is channel-invariant by construction.** The mel band is capped
at 3.8 kHz — a phone line discards everything above ~3.4 kHz, so we never look
there. Measured on held-out synthetic voices: same speaker scores 0.995–0.997
across full-bandwidth, quarter-volume and 8 kHz conditions; different speakers
score 0.00–0.64. Clean separation at the 0.82 threshold.

## Run it — three terminals

**1. Analysis service**
```bash
cd service
pip install fastapi uvicorn python-multipart librosa scikit-learn soundfile joblib
uvicorn service:app --port 8000 --reload
```

**2. API**
```bash
cd server
npm install
cp .env.example .env
npm run dev
```

**3. Client**
```bash
cd client
npm install
npm run dev
```

`GET /api/health` reports whether the Python service is reachable. If it is
not, the UI must say so — a user who sees silence will read it as safety.

## Train the synthesis model

Without `model.joblib` the service still runs; layer 1 reports 0 and the other
four carry the verdict. To enable it:

```bash
cd service
python prepare_data.py --audio <ASVspoof LA flac dir> \
                       --protocol <protocol .txt> --out data --per-class 2000
python make_fakes.py --n 80 --out data/fake        # multilingual TTS
python train.py --data data --codec-aug --limit 2000 --boost-times 25
```

**Record calibration clips through the browser you will demo in** and save them
as `data/real/demo_*.wav` and `data/fake/demo_*.wav`. ASVspoof is studio audio;
a browser applies gain control and Opus compression, which reads as synthesis
to a model that has never seen it. This is the single most common reason a
detector that scores well on paper flags your own voice on stage.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/analyze/identify` | audio + transcript + context → five-layer verdict |
| `POST /api/analyze/enrol/:contactId` | 1–8 clips → averaged voice profile |
| `GET  /api/challenges/suggestions` | starter questions |
| `POST /api/challenges/:contactId` | add a question and answer (answer is hashed) |
| `POST /api/challenges/:contactId/verify` | check an answer given mid-call |
| `GET  /api/health` | API + analysis service status |

## Known limits — say these before a judge finds them

- **Android cannot capture the far end of a normal cellular call** (OS
  restriction since Android 10). Ship on VoIP, speakerphone capture, or as a
  network-side service for a bank. This is a platform limit, not a code bug.
- The speaker embedding is classical, not a neural x-vector. Good for a small
  enrolled contact list; would not scale to one-in-ten-thousand identification.
- Synthesis detection degrades on generators absent from training. Layers 3–5
  do not depend on the model at all, which is the point of having them.
- A patient attacker who genuinely knows the family beats everything except
  the challenge.

---

## Live transcript — what was broken and what changed

The live transcript died silently mid-call. Three causes, all fixed in
`client/src/transcript.js`:

1. **Chrome ends recognition on every pause.** It fires `onend` after a few
   seconds of silence. The old handler set `listening = false` and stopped
   there, so the feature worked for one sentence and then quietly died. The
   controller now restarts while the user still wants to listen, with backoff
   so a persistent failure cannot spin.
2. **Interim results were discarded.** `interimResults` was enabled but only
   finalised text was used, so nothing appeared for several seconds. Interim
   text now renders immediately in grey italic and is replaced when the
   recogniser finalises the phrase.
3. **`stop()` then `start()` in the same tick throws `InvalidStateError`.**
   Starting is now sequenced behind `onend`.

Covered by `client/src/transcript.test.js` — five tests including the restart
path and the denied-microphone path. Run with `node --test src/transcript.test.js`.

### And an honesty fix

The browser Speech API ships audio to a cloud recogniser, which contradicts
"0 bytes leave the phone". So there is now a second, private path:

- `POST /transcribe` on the Python service runs Whisper locally
- `POST /api/analyze/transcribe` on Express proxies to it
- The UI shows an **OFFLINE TRANSCRIBE** button next to the live one

If Whisper is missing the endpoint returns 503 with an install hint rather
than failing obscurely. See `STACK.md` for the full rationale.
