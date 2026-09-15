import mongoose from "mongoose";

/**
 * Every analysed call is stored with the reasons behind the verdict, not just
 * the score. A bare "94% risk" is useless in a police report; "flagged on
 * absent breath noise and compressed dynamic range, caller failed the family
 * challenge" is evidence.
 *
 * This is what the problem statement means by explainability, and persisting
 * it is what turns a demo into something a cybercrime cell could act on.
 */
const layerSchema = new mongoose.Schema(
  {
    synthesis: { type: Number, default: 0 },
    identity: { type: Number, default: 0 },
    identityMatched: { type: Boolean, default: false },
    script: { type: Number, default: 0 },
    context: { type: Number, default: 0 },
    challenge: {
      type: String,
      enum: ["not_asked", "passed", "failed"],
      default: "not_asked"
    }
  },
  { _id: false }
);

const callRecordSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, trim: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null },
    durationSeconds: { type: Number, default: 0 },

    voiceMatchName: { type: String, default: "Unknown" },
    risk: { type: Number, default: 0 },
    band: {
      type: String,
      enum: ["low", "watch", "elevated", "high"],
      default: "low"
    },

    /** which quadrant of the synthesis x identity matrix this call landed in */
    cell: {
      type: String,
      enum: ["genuine", "clone_of_known_person", "synthetic_stranger", "unknown_human"],
      default: "unknown_human"
    },
    headline: { type: String, default: "" },

    layers: { type: layerSchema, default: () => ({}) },
    reasons: { type: [String], default: [] },
    transcript: { type: String, default: "" },
    language: { type: String, default: "unknown" },

    actionTaken: {
      type: String,
      enum: ["none", "challenge", "callback", "notify", "report"],
      default: "none"
    },
    reportedTo1930: { type: Boolean, default: false },
    notes: { type: String, default: "" }
  },
  { timestamps: true }
);

callRecordSchema.index({ createdAt: -1 });
callRecordSchema.index({ cell: 1, band: 1 });

export default mongoose.model("CallRecord", callRecordSchema);
