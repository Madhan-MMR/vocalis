import express from "express";
import multer from "multer";
import Contact from "../models/Contact.js";
import CallRecord from "../models/CallRecord.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(),
                        limits: { fileSize: 25 * 1024 * 1024 } });

const SERVICE = process.env.ANALYSIS_SERVICE || "http://127.0.0.1:8000";

/** Node owns contacts, history and the UI. Python owns the audio. */
async function callService(path, form) {
  const r = await fetch(`${SERVICE}${path}`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`analysis service ${r.status}: ${await r.text()}`);
  return r.json();
}

function blob(file) {
  return new Blob([file.buffer], { type: file.mimetype || "audio/wav" });
}

/* ------------------------------------------------------------------
   POST /api/analyze/identify
   The single call the client makes during a live call.
   ------------------------------------------------------------------ */
router.post("/identify", upload.single("audio"), async (req, res) => {
  try {
    const {
      phoneNumber = "",
      transcript = "",
      context = "{}",
      challengeResult = "not_asked",
      threshold = "0.82",
      save = "true"
    } = req.body;

    // Enrolled profiles become the identity layer's candidate set. Narrowing
    // by phone number first is not a shortcut — if the number is genuinely
    // theirs, a mismatch is far more meaningful than a global search.
    let contacts = await Contact.find({ "voiceProfiles.0": { $exists: true } });
    const exact = phoneNumber.trim()
      ? contacts.filter((c) => c.phone === phoneNumber.trim())
      : [];
    const pool = exact.length ? exact : contacts;

    const profiles = pool
      .map((c) => {
        const p = c.activeProfile();
        return p && { contact_id: String(c._id), name: c.name,
                      phone: c.phone, vector: p.vector };
      })
      .filter(Boolean);

    const form = new FormData();
    if (req.file) form.append("audio", blob(req.file), req.file.originalname || "call.wav");
    form.append("transcript", transcript);
    form.append("profiles", JSON.stringify(profiles));
    form.append("context", context);
    form.append("challenge_result", challengeResult);
    form.append("threshold", threshold);

    const out = await callService("/analyse", form);
    const v = out.verdict;

    // If the verdict warrants a challenge, hand the client a question to ask.
    // The answer never leaves the database, so the question alone is safe.
    let challengePrompt = null;
    if (v.challenge?.should_ask) {
      const best = out.identity?.best;
      const target = best
        ? await Contact.findById(best.contact_id)
        : exact[0] || null;
      const pick = target?.challenges?.length
        ? target.challenges[Math.floor(Math.random() * target.challenges.length)]
        : null;
      if (pick) {
        challengePrompt = { challengeId: String(pick._id),
                            contactId: String(target._id),
                            question: pick.question };
      }
    }

    let recordId = null;
    if (save === "true") {
      const rec = await CallRecord.create({
        phoneNumber: phoneNumber || "unknown",
        contactId: out.identity?.best?.contact_id || null,
        voiceMatchName: out.identity?.matched ? out.identity.best.name : "Unknown",
        durationSeconds: Math.round(out.synthesis?.duration_s || 0),
        risk: v.risk,
        band: v.band,
        cell: v.cell,
        headline: v.headline,
        layers: {
          synthesis: v.layers.synthesis,
          identity: v.layers.identity,
          identityMatched: v.layers.identity_matched,
          script: v.layers.script,
          context: v.layers.context,
          challenge: v.layers.challenge
        },
        reasons: v.reasons,
        transcript,
        language: out.script?.language || "unknown"
      });
      recordId = String(rec._id);
    }

    res.json({ ...out, challengePrompt, recordId });
  } catch (error) {
    // Never fail closed and silent — the user is mid-call and needs to know
    // the shield is not working rather than assume the call is safe.
    res.status(502).json({
      message: "Analysis service unavailable.",
      detail: error.message,
      hint: `Is the Python service running at ${SERVICE}? uvicorn service:app --port 8000`
    });
  }
});

/* ------------------------------------------------------------------
   POST /api/analyze/enrol/:contactId   (audio, repeatable)
   ------------------------------------------------------------------ */
router.post("/enrol/:contactId", upload.array("audio", 8), async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.contactId);
    if (!contact) return res.status(404).json({ message: "Contact not found." });
    if (!req.files?.length)
      return res.status(400).json({ message: "Send at least one audio clip." });

    const form = new FormData();
    req.files.forEach((f, i) =>
      form.append("audio", blob(f), f.originalname || `clip${i}.wav`));

    const prof = await callService("/enrol", form);
    contact.voiceProfiles.push({
      vector: prof.vector, dim: prof.vector.length,
      clipCount: prof.n_clips, spread: prof.spread, quality: prof.quality
    });
    await contact.save();

    res.json({ ok: true, quality: prof.quality, clips: prof.n_clips,
               spread: prof.spread, hint: prof.hint || null });
  } catch (error) {
    res.status(502).json({ message: "Enrolment failed.", detail: error.message });
  }
});

/* ------------------------------------------------------------------
   POST /api/analyze/transcribe
   Offline transcription via Whisper on the analysis service. Used when the
   browser has no speech recognition, when there is no internet, or when the
   user wants nothing leaving the machine.
   ------------------------------------------------------------------ */
router.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Send an audio file." });
    const form = new FormData();
    form.append("audio", blob(req.file), req.file.originalname || "call.wav");
    if (req.body.language) form.append("language", req.body.language);
    res.json(await callService("/transcribe", form));
  } catch (error) {
    res.status(502).json({
      message: "Offline transcription unavailable.",
      detail: error.message,
      hint: "Is Whisper installed in the analysis service, and ffmpeg on PATH?"
    });
  }
});

export default router;
