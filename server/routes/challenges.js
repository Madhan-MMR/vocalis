import express from "express";
import Contact from "../models/Contact.js";
import CallRecord from "../models/CallRecord.js";

const router = express.Router();
const SERVICE = process.env.ANALYSIS_SERVICE || "http://127.0.0.1:8000";

async function svc(path, fields) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  const r = await fetch(`${SERVICE}${path}`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`analysis service ${r.status}`);
  return r.json();
}

/* Suggestions, because the hard part is thinking of a good question.
   A good challenge is specific, shared, and absent from social media. */
const SUGGESTIONS = [
  "What did we eat at the last family wedding?",
  "What is the name of the street I grew up on?",
  "Which relative always falls asleep after lunch?",
  "What did you break in the kitchen last year?",
  "What nickname does only this family use for me?",
  "Which shop do we always stop at on the way home?"
];

router.get("/suggestions", (req, res) => res.json({ suggestions: SUGGESTIONS }));

/* ---- add a challenge to a contact ---- */
router.post("/:contactId", async (req, res) => {
  try {
    const { question, answer } = req.body;
    if (!question?.trim() || !answer?.trim())
      return res.status(400).json({ message: "Both a question and an answer are required." });
    if (answer.trim().length < 2)
      return res.status(400).json({ message: "That answer is too short to be a real check." });

    const contact = await Contact.findById(req.params.contactId);
    if (!contact) return res.status(404).json({ message: "Contact not found." });

    const salt = Contact.newSalt();
    const { hash } = await svc("/challenge/hash", { answer, salt });

    contact.challenges.push({ question: question.trim(), answerHash: hash, salt });
    await contact.save();

    // deliberately never echo the answer back
    res.json({ ok: true, question: question.trim(),
               total: contact.challenges.length });
  } catch (error) {
    res.status(502).json({ message: "Could not save the challenge.", detail: error.message });
  }
});

/* ---- verify an answer given during a live call ---- */
router.post("/:contactId/verify", async (req, res) => {
  try {
    const { challengeId, given, recordId } = req.body;
    const contact = await Contact.findById(req.params.contactId)
      .select("+challenges.answerHash +challenges.salt");
    if (!contact) return res.status(404).json({ message: "Contact not found." });

    const ch = contact.challenges.id(challengeId);
    if (!ch) return res.status(404).json({ message: "Challenge not found." });

    const { passed } = await svc("/challenge/verify", {
      given: given || "", stored_hash: ch.answerHash, salt: ch.salt
    });

    ch.timesAsked += 1;
    if (passed) ch.timesPassed += 1;
    ch.lastAskedAt = new Date();
    await contact.save();

    // A failed challenge is the strongest signal in the system, so it is
    // written straight onto the call record.
    if (recordId) {
      await CallRecord.findByIdAndUpdate(recordId, {
        "layers.challenge": passed ? "passed" : "failed",
        risk: passed ? 0.2 : 0.95,
        band: passed ? "low" : "high",
        headline: passed
          ? "Caller answered your security question correctly"
          : "Caller could not answer your security question",
        actionTaken: "challenge"
      });
    }

    res.json({
      passed,
      message: passed
        ? "Correct. This is very likely the real person."
        : "Wrong answer. Hang up and call back on the number you already have."
    });
  } catch (error) {
    res.status(502).json({ message: "Verification failed.", detail: error.message });
  }
});

router.delete("/:contactId/:challengeId", async (req, res) => {
  const contact = await Contact.findById(req.params.contactId);
  if (!contact) return res.status(404).json({ message: "Contact not found." });
  contact.challenges.pull({ _id: req.params.challengeId });
  await contact.save();
  res.json({ ok: true, total: contact.challenges.length });
});

export default router;
