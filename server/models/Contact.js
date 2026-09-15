import mongoose from "mongoose";
import crypto from "crypto";

/**
 * A challenge is a fact only the real family knows.
 *
 * This is the layer that does not lose the arms race. Every acoustic method
 * degrades as cloning improves; a cloned voice can copy the sound perfectly
 * and still cannot answer "what did we eat at Meera's wedding".
 *
 * Answers are stored hashed with a per-challenge salt. A challenge bank in
 * plain text is a list of exactly the facts an attacker needs, so the answer
 * must never touch the database in readable form.
 */
const challengeSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answerHash: { type: String, required: true, select: false },
    salt: { type: String, required: true, select: false },
    timesAsked: { type: Number, default: 0 },
    timesPassed: { type: Number, default: 0 },
    lastAskedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

/**
 * 57-dimensional MFCC-statistics embedding from the analysis service.
 * Replaces the four-number fingerprint (energy, centroid, crossings,
 * voicedRatio), which measured the microphone rather than the speaker.
 */
const voiceProfileSchema = new mongoose.Schema(
  {
    vector: { type: [Number], required: true },
    dim: { type: Number, default: 57 },
    clipCount: { type: Number, default: 1 },
    spread: { type: Number, default: 0 },       // lower = more consistent enrolment
    quality: { type: String, enum: ["weak", "fair", "good"], default: "fair" },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    organization: { type: String, default: "", trim: true },
    relationship: { type: String, default: "", trim: true },
    voiceProfiles: { type: [voiceProfileSchema], default: [] },
    challenges: { type: [challengeSchema], default: [] },
    /** set by the user for people whose voice being cloned would cost the most */
    highValue: { type: Boolean, default: false }
  },
  { timestamps: true }
);

contactSchema.methods.activeProfile = function () {
  if (!this.voiceProfiles.length) return null;
  // most recent enrolment wins — voices drift, and so do microphones
  return this.voiceProfiles[this.voiceProfiles.length - 1];
};

contactSchema.statics.newSalt = () => crypto.randomBytes(16).toString("hex");

export default mongoose.model("Contact", contactSchema);
