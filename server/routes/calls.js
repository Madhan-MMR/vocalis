import express from "express";
import CallRecord from "../models/CallRecord.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    res.json(await CallRecord.find().sort({ createdAt: -1 }).limit(100).lean());
  } catch (error) {
    res.status(500).json({ message: "Could not load call history.", detail: error.message });
  }
});

router.get("/:callId", async (req, res) => {
  try {
    const call = await CallRecord.findById(req.params.callId).lean();
    if (!call) return res.status(404).json({ message: "Call record not found." });
    res.json(call);
  } catch (error) {
    res.status(400).json({ message: "Invalid call record id.", detail: error.message });
  }
});

export default router;
