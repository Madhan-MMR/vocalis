/**
 * Live transcript controller.
 *
 * Three things were wrong with the previous version:
 *
 * 1. Chrome stops recognition after a few seconds of silence and fires
 *    `onend`. The old handler just set listening = false, so the transcript
 *    died silently mid-call and looked broken. This one restarts whenever the
 *    user still wants to listen.
 *
 * 2. `interimResults` was on but interim text was thrown away, so nothing
 *    appeared on screen until a phrase finalised. On a real call that reads
 *    as a dead feature. Interim text is now surfaced separately, so the user
 *    sees words the moment they are spoken.
 *
 * 3. Calling `stop()` and then `start()` on a new instance in the same tick
 *    throws InvalidStateError. Starting is now sequenced behind `onend`.
 *
 * Worth being honest about in the pitch: the browser Speech API sends audio
 * to a cloud service, which contradicts the on-device privacy claim. It is
 * here because it is instant and needs no install. The private path is
 * server-side Whisper (`transcribeViaServer` below), which runs locally and
 * offline. The UI offers both.
 */

const NON_FATAL = new Set(["no-speech", "aborted", "network"]);

export function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSecureEnough() {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
}

export function extractResults(event) {
  let final = "";
  let interim = "";
  const start = typeof event.resultIndex === "number" ? event.resultIndex : 0;
  for (let i = start; i < event.results.length; i += 1) {
    const r = event.results[i];
    const text = r?.[0]?.transcript ?? "";
    if (r?.isFinal) final += `${text.trim()} `;
    else interim += text;
  }
  return { final: final.trim(), interim: interim.trim() };
}

/**
 * createTranscriber({ lang, onFinal, onInterim, onStatus, onStateChange })
 * Returns { start, stop, setLang, isRunning }.
 */
export function createTranscriber({
  lang = "en-IN",
  onFinal = () => {},
  onInterim = () => {},
  onStatus = () => {},
  onStateChange = () => {},
} = {}) {
  const Ctor = getSpeechRecognitionCtor();
  let recognition = null;
  let wanted = false;          // does the user still want to listen?
  let restarts = 0;
  let restartTimer = null;
  let currentLang = lang;

  function cleanup() {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      recognition = null;
    }
  }

  function spawn() {
    if (!wanted) return;
    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = currentLang;

    recognition.onstart = () => {
      restarts = 0;
      onStateChange(true);
      onStatus("Listening — speak normally, the transcript fills as you go.");
    };

    recognition.onresult = (event) => {
      const { final, interim } = extractResults(event);
      if (interim) onInterim(interim);
      if (final) {
        onInterim("");
        onFinal(final);
      }
    };

    recognition.onerror = (event) => {
      const code = event.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        wanted = false;
        onStateChange(false);
        onStatus(
          "Microphone access is blocked. Allow it in the browser address bar, " +
          "then start the live transcript again."
        );
        return;
      }
      if (!NON_FATAL.has(code)) {
        wanted = false;
        onStateChange(false);
        onStatus(`Live transcript stopped (${code}). You can type the transcript instead.`);
      }
      // non-fatal errors fall through to onend, which restarts
    };

    recognition.onend = () => {
      const previous = recognition;
      cleanup();
      if (!wanted) {
        onStateChange(false);
        return;
      }
      // Chrome ends the session on every pause. Restart, but back off so a
      // persistent failure cannot spin.
      restarts += 1;
      if (restarts > 12) {
        wanted = false;
        onStateChange(false);
        onStatus("Live transcript kept dropping. Type the transcript, or use offline transcription.");
        return;
      }
      restartTimer = setTimeout(spawn, Math.min(250 * restarts, 1500));
      void previous;
    };

    try {
      recognition.start();
    } catch {
      // start() throws if a previous session has not fully ended; onend will
      // fire and the restart path picks it up
    }
  }

  return {
    isRunning: () => wanted,
    setLang(next) {
      currentLang = next;
      if (wanted) {
        // restart so the new language takes effect immediately
        const r = recognition;
        if (r) r.stop();
      }
    },
    start() {
      if (!Ctor) {
        onStatus(
          "This browser has no live speech recognition. Use Chrome or Edge, " +
          "or switch to offline transcription."
        );
        return false;
      }
      if (!isSecureEnough()) {
        onStatus("Live transcript needs HTTPS or localhost. Open the app on localhost.");
        return false;
      }
      if (wanted) return true;
      wanted = true;
      restarts = 0;
      spawn();
      return true;
    },
    stop() {
      wanted = false;
      const r = recognition;
      cleanup();
      try {
        r?.stop();
      } catch {
        /* already stopped */
      }
      onInterim("");
      onStateChange(false);
      onStatus("Live transcript stopped. You can edit the text before analysing.");
    },
  };
}

/**
 * The private path: send the recording to our own service and let Whisper
 * transcribe it locally. Slower than the browser API, but nothing leaves the
 * machine and it works with no internet.
 */
export async function transcribeViaServer(blob, filename = "call.wav", language = "") {
  const form = new FormData();
  form.append("audio", blob, filename);
  if (language) form.append("language", language.split("-")[0]);

  const res = await fetch("/api/analyze/transcribe", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "Offline transcription failed.");
  return body;
}
