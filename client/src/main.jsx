import React, { StrictMode, useEffect, useRef, useState } from "react";
import { createTranscriber, transcribeViaServer, getSpeechRecognitionCtor } from "./transcript.js";
import { createRoot } from "react-dom/client";
import VerdictPanel from "../VerdictPanel.jsx";
import "../verdict-panel.css";
import "./styles.css";

function App() {
  const [audio, setAudio] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [result, setResult] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [contacts, setContacts] = useState([]);
  const [contactForm, setContactForm] = useState({ name: "", phone: "", relationship: "" });
  const [contactStatus, setContactStatus] = useState("");
  const [selectedContact, setSelectedContact] = useState(null);
  const [enrollmentFiles, setEnrollmentFiles] = useState([]);
  const [enrollmentStatus, setEnrollmentStatus] = useState("");
  const [project, setProject] = useState(null);
  const [callHistory, setCallHistory] = useState([]);
  const [analysisHealth, setAnalysisHealth] = useState(null);
  const [insights, setInsights] = useState(null);
  const [language, setLanguage] = useState("en-IN");
  const [actionGating, setActionGating] = useState(true);
  const [contextFlags, setContextFlags] = useState({ unknown_number: false, first_contact: false, claims_known_person: false, number_reported_before: false });
  const inputRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const speechRef = useRef(null);

  useEffect(() => {
    fetch("http://localhost:2026/api/contacts")
      .then((response) => response.ok ? response.json() : [])
      .then(setContacts)
      .catch(() => setContactStatus("Contacts API is unavailable."));
    fetch("http://localhost:2026/api/project")
      .then((response) => response.ok ? response.json() : null)
      .then(setProject)
      .catch(() => {});
    fetch("http://localhost:2026/api/calls")
      .then((response) => response.ok ? response.json() : [])
      .then(setCallHistory)
      .catch(() => {});
    fetch("http://localhost:8000/health")
      .then((response) => response.ok ? response.json() : null)
      .then(setAnalysisHealth)
      .catch(() => {});
    fetch("http://localhost:2026/api/insights/summary")
      .then((response) => response.ok ? response.json() : null)
      .then(setInsights)
      .catch(() => {});
    return () => {
      clearInterval(timerRef.current);
      speechRef.current?.stop?.();
      speechRef.current = null;
    };
  }, []);

  async function exportInsights() {
    const response = await fetch("http://localhost:2026/api/insights/export");
    if (!response.ok) return;
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vocalis-call-insights.csv";
    link.click();
    window.URL.revokeObjectURL(url);
  }

  async function addContact(event) {
    event.preventDefault();
    setContactStatus("Saving contact...");
    try {
      const response = await fetch("http://localhost:2026/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Could not save contact.");
      setContacts((current) => [...current, body]);
      setContactForm({ name: "", phone: "", relationship: "" });
      setContactStatus(`${body.name} added. Enroll three voice clips next.`);
    } catch (error) {
      setContactStatus(error.message);
    }
  }

  async function enrollVoice() {
    if (!selectedContact || enrollmentFiles.length < 3) {
      setEnrollmentStatus("Select a contact and choose at least three clips.");
      return;
    }
    setEnrollmentStatus("Enrolling voice profile...");
    const form = new FormData();
    enrollmentFiles.forEach((file) => form.append("audio", file, file.name));
    try {
      const response = await fetch(`http://localhost:2026/api/analyze/enrol/${selectedContact._id}`, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || body.detail || "Enrollment failed.");
      setContacts((current) => current.map((contact) => contact._id === selectedContact._id
        ? { ...contact, voiceProfiles: [...(contact.voiceProfiles || []), { quality: body.quality }] }
        : contact));
      setSelectedContact({ ...selectedContact, voiceProfiles: [...(selectedContact.voiceProfiles || []), { quality: body.quality }] });
      setEnrollmentFiles([]);
      setEnrollmentStatus(`Enrolled ${body.clips} clips. Profile quality: ${body.quality}.`);
    } catch (error) {
      setEnrollmentStatus(error.message);
    }
  }

  // The transcriber is created once and reused. Recreating it on every
  // toggle was part of why the old version threw InvalidStateError.
  useEffect(() => {
    speechRef.current = createTranscriber({
      lang: language,
      onFinal: (text) => setTranscript((cur) => `${cur} ${text}`.trim()),
      onInterim: setInterim,
      onStatus: setStatus,
      onStateChange: setListening,
    });
    return () => speechRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    speechRef.current?.setLang(language);
  }, [language]);

  function toggleTranscription() {
    const t = speechRef.current;
    if (!t) return;
    if (t.isRunning()) t.stop();
    else t.start();
  }

  // Offline path: transcribe the recording locally with Whisper. Nothing
  // leaves the machine, and it works with no internet.
  async function transcribeOffline() {
    if (!audio) {
      setStatus("Record or upload audio first, then transcribe it offline.");
      return;
    }
    setTranscribing(true);
    setStatus("Transcribing locally with Whisper. This takes a few seconds...");
    try {
      const out = await transcribeViaServer(audio, audio.name || "call.wav", language);
      if (out.text) {
        setTranscript((cur) => `${cur} ${out.text}`.trim());
        setStatus(`Transcribed offline (${out.language || "auto"}, ${out.engine}).`);
      } else {
        setStatus(`Nothing recognised. ${out.engine || ""}`.trim());
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      setTranscribing(false);
    }
  }

  async function toWav(blob) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return blob;
    const context = new AudioContextClass();
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const channels = Math.min(buffer.numberOfChannels, 2);
      const frames = buffer.length;
      const wav = new ArrayBuffer(44 + frames * channels * 2);
      const view = new DataView(wav);
      const write = (offset, value) => view.setUint32(offset, value, true);
      const writeShort = (offset, value) => view.setUint16(offset, value, true);
      write(0, 0x46464952);
      write(4, 36 + frames * channels * 2);
      write(8, 0x45564157);
      write(12, 0x20746d66);
      write(16, 16);
      writeShort(20, 1);
      writeShort(22, channels);
      write(24, buffer.sampleRate);
      write(28, buffer.sampleRate * channels * 2);
      writeShort(32, channels * 2);
      writeShort(34, 16);
      write(36, 0x61746164);
      write(40, frames * channels * 2);
      const channelData = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
      let offset = 44;
      for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
          offset += 2;
        }
      }
      return new Blob([wav], { type: "audio/wav" });
    } finally {
      await context.close();
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Microphone recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        toWav(blob).then((wav) => {
          setAudio(new File([wav], `vocalis-recording-${Date.now()}.wav`, { type: "audio/wav" }));
          setRecording(false);
          clearInterval(timerRef.current);
          setStatus("Recording ready to analyse.");
        }).catch(() => {
          setRecording(false);
          clearInterval(timerRef.current);
          setStatus("Could not convert the recording. Please upload a WAV file instead.");
        });
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecordSeconds(0);
      setRecording(true);
      setStatus("Recording microphone audio...");
      timerRef.current = setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000);
    } catch {
      setStatus("Microphone permission was denied.");
    }
  }

  async function analyze() {
    setDemoMode(false);
    setBusy(true);
    setStatus("Analysing five layers...");
    try {
      const form = new FormData();
      if (audio) form.append("audio", audio, audio.name);
      form.append("transcript", transcript);
      form.append("phoneNumber", selectedContact?.phone || "");
      form.append("context", JSON.stringify(contextFlags));
      form.append("save", "true");
      const response = await fetch("http://localhost:2026/api/analyze/identify", { method: "POST", body: form });
      const body = await response.text();
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error(`Analysis service returned an invalid response (${response.status}).`);
      }
      if (!response.ok) throw new Error(data.message || data.error || "Analysis failed");
      setResult(data);
      setCallHistory((current) => data.recordId ? [{ ...data, _id: data.recordId, headline: data.verdict.headline, band: data.verdict.band, risk: data.verdict.risk, createdAt: new Date().toISOString() }, ...current] : current);
      setStatus("Analysis complete.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function runDemo() {
    setTranscript("Maa, I am in trouble. Do not tell anyone. Send 25,000 rupees to this UPI right now. Do not hang up or call back.");
    setDemoMode(true);
    setResult({
      verdict: {
        risk: 0.94, band: "high",
        headline: "This may be a cloned voice of someone you know",
        cell: "clone_of_known_person",
        cell_label: "Cloned voice of someone you know",
        cell_detail: "The voice resembles an enrolled contact while showing strong machine-generation signals.",
        layers: { synthesis: 0.91, identity: 0.98, identity_matched: true, script: 0.93, context: 0.8, challenge: "not_asked" },
        reasons: [
          "Voice: synthetic spectral pattern detected",
          "Identity: voice matches Priya (98% similarity)",
          "Script: payment demand",
          "Script: secrecy and urgency",
          "Caller: number was reported by other users"
        ],
        actions: [
          { id: "challenge", label: "Ask them your security question", detail: "A fact only your real family knows. A cloned voice can copy the sound perfectly and still cannot answer this.", primary: true },
          { id: "callback", label: "Hang up and call back on the saved number", detail: "Dials the number stored in your contacts, not the one calling you." },
          { id: "report", label: "Report to 1930 cybercrime helpline", detail: "Files the number, timestamp and artifact report." }
        ],
        challenge: { should_ask: true, result: "not_asked" }
      },
      synthesis: { score: 0.91, band: "high", reasons: [{ reason: "synthetic spectral pattern detected" }], n_windows: 14, duration_s: 18, available: true },
      identity: { matched: true, best: { name: "Priya", similarity: 0.98 }, ranked: [] },
      script: { risk: 0.93, scores: { urgency: 1, secrecy: 1, payment_demand: 1, isolation: 0.5 }, summary: "Detected urgency, secrecy, payment demand, isolation", language: "English", engine: "demo-scenario" }
    });
    setStatus("Demo loaded: targeted cloned-voice scam.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">V</span><span>VOCALIS</span></div>
        <div className="topbar-meta"><span className="live-pill"><span className="pulse" /> LIVE</span><span className="tagline">FIVE-LAYER VOICE FRAUD SHIELD</span></div>
      </header>
      <section className="hero">
        <p className="eyebrow">CALL PROTECTION / LIVE ANALYSIS</p>
        <h1>Know who is really<br /><em>on the line.</em></h1>
        <p className="intro">Analyse a caller's voice, words, and context before trust becomes a vulnerability.</p>
        {project && <div className="project-strip"><span>{project.psNumber}</span><b>{project.title}</b><small>{project.organisation} · {project.department}</small></div>}
      </section>
      <section className="metric-row">
        <div className="metric"><span>TRUSTED CONTACTS</span><b>{contacts.length}</b><small>{contacts.filter((contact) => contact.voiceProfiles?.length).length} enrolled</small></div>
        <div className="metric"><span>CALLS ANALYSED</span><b>{callHistory.length || insights?.summary?.total || 0}</b><small>MongoDB history</small></div>
        <div className="metric"><span>MODEL STATUS</span><b className={analysisHealth?.synthesis_model ? "metric-warn" : "metric-alert"}>{analysisHealth?.synthesis_model ? "READY" : "CHECK"}</b><small>{analysisHealth?.deepfake_transformer ? "Transformer + acoustic" : "Acoustic model status"}</small></div>
      </section>

      {insights && <section className="insights-panel">
        <div className="card-heading"><span className="step">04</span><h2>Threat intelligence</h2></div>
        <div className="insights-grid">
          <div className="mini-stat"><span>AVG RISK</span><b>{Math.round((insights.summary?.averageRisk || 0) * 100)}%</b></div>
          <div className="mini-stat"><span>HIGH RISK</span><b>{insights.summary?.byBand?.high || 0}</b></div>
          <div className="mini-stat"><span>UNIQUE NUMBERS</span><b>{insights.summary?.uniqueNumbers || 0}</b></div>
        </div>
        <div className="insights-footer">
          <div className="band-breakdown">
            {Object.entries(insights.summary?.byBand || {}).map(([band, value]) => (
              <div key={band} className="band-pill"><span>{band}</span><strong>{value}</strong></div>
            ))}
          </div>
          <button className="export-button" onClick={exportInsights}>EXPORT CSV</button>
        </div>
      </section>}
      <section className="protection-bar">
        <div className="protection-copy"><span className="eyebrow">PROTECTION CONTROLS</span><strong>{actionGating && result?.verdict?.risk >= 0.5 ? "Sensitive actions gated" : "Monitoring active"}</strong><small>{analysisHealth?.synthesis_model ? "Acoustic synthesis model online" : "Synthesis model unavailable; result stays unverified"}</small></div>
        <label className="select-control"><span>TRANSCRIPTION</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en-IN">English / India</option><option value="hi-IN">Hindi</option><option value="bn-IN">Bengali</option><option value="ta-IN">Tamil</option><option value="te-IN">Telugu</option><option value="mr-IN">Marathi</option><option value="kn-IN">Kannada</option></select></label>
        <label className="toggle-control"><input type="checkbox" checked={actionGating} onChange={(event) => setActionGating(event.target.checked)} /><span className="toggle-track" /><span>GATE ACTIONS</span></label>
      </section>
      <section className="workspace">
        <div className="control-card">
          <div className="card-heading"><span className="step">01</span><h2>Capture a call</h2></div>
          <p className="muted">Upload a short recording, or analyse the transcript alone.</p>
          <input ref={inputRef} type="file" accept="audio/*" hidden onChange={(e) => setAudio(e.target.files?.[0] || null)} />
          <div className="capture-actions">
            <button className={`record ${recording ? "recording" : ""}`} onClick={toggleRecording}>
              <span className="record-dot" /> {recording ? `Stop recording (${recordSeconds}s)` : "Record microphone"}
            </button>
            <button className="upload" onClick={() => inputRef.current?.click()}>
            <span className="upload-icon">+</span>
            <span>{audio ? audio.name : "Choose an audio recording"}</span>
            </button>
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="transcript">TRANSCRIPT / CALL NOTES</label>
            <button className="listen-button" onClick={transcribeOffline} disabled={transcribing || !audio} title="Runs Whisper locally. Nothing leaves this machine.">
              {transcribing ? "TRANSCRIBING..." : "OFFLINE TRANSCRIBE"}
            </button>
            <button className={`listen-button ${listening ? "listening" : ""}`} onClick={toggleTranscription}>
              {listening ? "STOP TRANSCRIPT" : "START LIVE TRANSCRIPT"}
            </button>
          </div>
          <textarea id="transcript" value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Paste what the caller said..." rows="6" />
          {interim ? <p className="interim-line">{interim}</p> : null}
          {!getSpeechRecognitionCtor() ? <p className="muted small">This browser has no live speech recognition. Use OFFLINE TRANSCRIBE, or type the transcript.</p> : null}
          <button className="analyze" onClick={analyze} disabled={busy}>{busy ? "ANALYSING..." : "ANALYSE CALL  →"}</button>
          <button className="demo-button" onClick={runDemo}>▶ RUN ATTACK DEMO</button>
          {status && <p className="status">{status}</p>}
          <div className="service-note"><span className="pulse" /> Analysis service connected · port 8000</div>
          <div className="context-section">
            <div className="field-row"><label className="field-label">CALL CONTEXT</label><span className="clip-count">feeds risk score</span></div>
            <div className="context-grid">{[["unknown_number", "Unknown number"], ["first_contact", "First contact"], ["claims_known_person", "Claims known person"], ["number_reported_before", "Reported before"]].map(([key, label]) => <label className="context-option" key={key}><input type="checkbox" checked={contextFlags[key]} onChange={(event) => setContextFlags({ ...contextFlags, [key]: event.target.checked })} /><span>{label}</span></label>)}</div>
          </div>
          <div className="contacts-section">
            <div className="card-heading"><span className="step">03</span><h2>Trusted contacts</h2></div>
            <p className="muted">Add someone you know, then enroll three clips of their voice.</p>
            <form className="contact-form" onSubmit={addContact}>
              <input required placeholder="Name" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} />
              <input required placeholder="Phone number" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} />
              <input placeholder="Relationship (optional)" value={contactForm.relationship} onChange={(e) => setContactForm({ ...contactForm, relationship: e.target.value })} />
              <button className="add-contact" type="submit">ADD CONTACT</button>
            </form>
            {contacts.length > 0 && <div className="contact-list">{contacts.map((contact) => <div className={`contact-row ${selectedContact?._id === contact._id ? "is-selected" : ""}`} key={contact._id} onClick={() => setSelectedContact(contact)}><strong>{contact.name}</strong><span>{contact.phone}</span><small>{contact.voiceProfiles?.length || 0} voice profiles · click to enroll</small></div>)}</div>}
            {contactStatus && <p className="status">{contactStatus}</p>}
            {selectedContact && <div className="enrollment-box">
              <div className="field-row"><label className="field-label" htmlFor="voice-clips">ENROLL {selectedContact.name.toUpperCase()}</label><span className="clip-count">{enrollmentFiles.length}/3 clips</span></div>
              <input id="voice-clips" type="file" accept="audio/*" multiple onChange={(event) => setEnrollmentFiles(Array.from(event.target.files || []).slice(0, 8))} />
              <button className="add-contact" type="button" onClick={enrollVoice}>ENROLL VOICE PROFILE</button>
              {enrollmentStatus && <p className="status">{enrollmentStatus}</p>}
            </div>}
          </div>
        </div>
        <div className="result-card">
          <div className="card-heading"><span className="step">02</span><h2>Verdict</h2></div>
          {demoMode && <div className="demo-badge">DEMO SCENARIO · SYNTHETIC DATA</div>}
          <VerdictPanel result={result} onAction={() => {}} />
          <div className="history-section">
            <div className="field-row"><label className="field-label">RECENT CALL HISTORY</label><span className="clip-count">{callHistory.length} records</span></div>
            {callHistory.length ? <div className="history-list">{callHistory.slice(0, 5).map((call) => <div className="history-row" key={call._id}><span className={`history-dot ${call.band || "low"}`} /><div><strong>{call.headline || "Analysed call"}</strong><small>{call.cell || "unknown"} · {new Date(call.createdAt).toLocaleString()}</small></div><b>{Math.round((call.risk || 0) * 100)}%</b></div>)}</div> : <p className="muted">Your saved call verdicts will appear here.</p>}
          </div>
        </div>
      </section>
      <footer>VOCALIS / PRIVACY-FIRST VOICE INTELLIGENCE</footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
