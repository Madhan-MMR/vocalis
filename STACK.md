# Why each part is written in what it is written in

Vocalis is deliberately polyglot. Nothing here is Python-for-the-sake-of-Python
or JavaScript-for-the-sake-of-JavaScript — each tier uses the language that is
actually strongest for its job, and they talk over HTTP so none of them
constrain the others.

| Tier | Language | Why not the others |
|---|---|---|
| **Client** (`client/`) | **JavaScript / React + Vite** | The UI has to run inside a browser, capture the microphone through `MediaRecorder`, and drive the Web Speech API. None of that is reachable from Python. Vite gives sub-second reloads during a hackathon. |
| **API** (`server/`) | **JavaScript / Node + Express** | This tier is almost entirely I/O: HTTP in, MongoDB out, HTTP to the ML service. Node's event loop is built for exactly that, and Mongoose is the best-supported MongoDB layer anywhere. Running this in Python would add a language boundary for no gain. |
| **ML service** (`service/`) | **Python + FastAPI** | librosa, scikit-learn and Whisper have no serious equivalent in JavaScript. Signal processing and model inference belong in Python, full stop. FastAPI keeps the HTTP surface thin so the Python process does nothing but audio. |
| **Persistence** | **MongoDB** | Call records are nested, variable-shape documents — layers, reasons, challenge outcomes. Forcing that into fixed relational tables would cost schema churn for no benefit. |

## The boundary that matters

**Audio never crosses the API tier.** The client posts audio straight to
Node, which streams it to the Python service and keeps only the verdict. The
API tier stores contacts, history and artifact trails — never raw recordings.
On mobile the ML tier collapses onto the device entirely.

That is a deployment decision, not an accident of layout, and it is the thing
to say out loud when someone asks about privacy.

## What stays in each language

- **Feature extraction, embedding, fusion, verdict logic** — Python. These are
  numerical and belong next to numpy.
- **Session state, auth boundaries, routing, persistence** — JavaScript. These
  are I/O and belong next to the database.
- **Microphone, recording, WAV conversion, live recognition, rendering** —
  JavaScript in the browser. Nothing else can reach those APIs.

## Transcription is deliberately two paths

| Path | Language | Speed | Privacy | Needs internet |
|---|---|---|---|---|
| Browser Web Speech API | JS, in-browser | instant | audio goes to a cloud recogniser | yes |
| Whisper | Python, local | a few seconds | nothing leaves the machine | no |

Both are exposed in the UI. The browser API is the convenient default; Whisper
is the honest one. **Say this plainly if a judge asks about the on-device
claim** — the browser path is a convenience, and the private path exists and
works.
