import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Project from "../models/Project.js";
import contactRoutes from "../routes/contacts.js";
import callRoutes from "../routes/calls.js";
import analyzeRoutes from "../routes/analyze.js";
import challengeRoutes from "../routes/challenges.js";
import insightsRoutes from "../routes/insights.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 2026;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173"
  })
);
app.use(express.json({ limit: "1mb" }));

// Health reports the Python service too. If the analysis service is down the
// shield is not working, and the UI must be able to say so rather than let a
// user read silence as safety.
app.get("/api/health", async (req, res) => {
  const SERVICE = process.env.ANALYSIS_SERVICE || "http://127.0.0.1:8000";
  let analysis = { reachable: false };
  try {
    const r = await fetch(`${SERVICE}/health`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) analysis = { reachable: true, ...(await r.json()) };
  } catch (e) {
    analysis.error = e.message;
  }
  res.json({ ok: true, service: "vocalis-api", analysisService: analysis });
});

app.use("/api/contacts", contactRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/analyze", analyzeRoutes);
app.use("/api/challenges", challengeRoutes);
app.use("/api/insights", insightsRoutes);

app.get("/api/project", async (req, res) => {
  try {
    const project = await Project.findOne({ psNumber: "SIH26104" }).lean();
    if (!project) return res.status(404).json({ message: "Project not found." });
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: "Could not load project metadata.", detail: error.message });
  }
});

const projectMetadata = {
  psNumber: "SIH26104",
  title: "AI-Powered Real-Time Detection and Prevention of Voice Cloning Impersonation Attacks",
  organisation: "All India Council for Technical Education (AICTE)",
  department: "Cyber Security Cell",
  category: "Software",
  theme: "Miscellaneous"
};

async function start() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/vocalis"
    );
    await Project.findOneAndUpdate(
      { psNumber: projectMetadata.psNumber },
      projectMetadata,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log("MongoDB connected");
  } catch (error) {
    console.warn("MongoDB unavailable; continuing in degraded mode.", error.message);
  }

  app.listen(PORT, () => {
    console.log(`Vocalis API running at http://localhost:${PORT}`);
  });
}

start();
