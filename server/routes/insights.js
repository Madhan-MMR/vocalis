import express from "express";
import CallRecord from "../models/CallRecord.js";
import { summarizeCalls, toCsv } from "../utils/insights.js";

const router = express.Router();

router.get("/summary", async (_req, res) => {
  try {
    const calls = await CallRecord.find().sort({ createdAt: -1 }).limit(500).lean();
    const summary = summarizeCalls(calls);
    const suspiciousNumbers = Object.entries(
      calls.reduce((acc, call) => {
        const phone = String(call.phoneNumber || "unknown");
        if (!acc[phone]) acc[phone] = { phone, count: 0, maxRisk: 0 };
        acc[phone].count += 1;
        acc[phone].maxRisk = Math.max(acc[phone].maxRisk, Number(call.risk || 0));
        return acc;
      }, {})
    )
      .map(([, value]) => value)
      .sort((a, b) => b.maxRisk - a.maxRisk || b.count - a.count)
      .slice(0, 5);

    res.json({
      summary,
      suspiciousNumbers,
      latest: calls.slice(0, 5).map((call) => ({
        phoneNumber: call.phoneNumber,
        risk: call.risk,
        band: call.band,
        headline: call.headline,
        createdAt: call.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Could not load insights.", detail: error.message });
  }
});

router.get("/export", async (_req, res) => {
  try {
    const calls = await CallRecord.find().sort({ createdAt: -1 }).limit(1000).lean();
    const csv = toCsv(calls.map((call) => ({
      phoneNumber: call.phoneNumber,
      risk: call.risk,
      band: call.band,
      headline: call.headline
    })));

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=vocalis-call-insights.csv");
    res.send(csv);
  } catch (error) {
    res.status(500).json({ message: "Could not export insights.", detail: error.message });
  }
});

export default router;
