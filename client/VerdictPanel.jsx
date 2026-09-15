import React, { useState } from "react";

/**
 * The screen a frightened person actually looks at.
 *
 * Two rules shaped this:
 *
 * 1. The matrix is shown, not hidden. A judge and a user both need to see
 *    *which* of the four situations this is, because "cloned voice of someone
 *    you know" and "robocall from a stranger" call for different reactions.
 *
 * 2. Every alert ends in a button. Detection without a next step is useless
 *    to someone who is scared and being rushed.
 */

const BANDS = {
  high:     { label: "HIGH RISK", color: "#ff4a5f", bg: "rgba(255,74,95,.12)" },
  elevated: { label: "ELEVATED",  color: "#ffb020", bg: "rgba(255,176,32,.12)" },
  watch:    { label: "WATCH",     color: "#d4d34a", bg: "rgba(212,211,74,.10)" },
  low:      { label: "LOW",       color: "#3dd68c", bg: "rgba(61,214,140,.10)" }
};

const CELLS = {
  clone_of_known_person: { row: 0, col: 1 },
  genuine:               { row: 0, col: 0 },
  synthetic_stranger:    { row: 1, col: 1 },
  unknown_human:         { row: 1, col: 0 }
};

function Matrix({ cell }) {
  const cells = [
    [{ k: "genuine", t: "Genuine call" },
     { k: "clone_of_known_person", t: "Cloned voice of someone you know" }],
    [{ k: "unknown_human", t: "Unrecognised person" },
     { k: "synthetic_stranger", t: "Machine voice, unknown" }]
  ];
  return (
    <div className="vk-matrix">
      <div className="vk-matrix-head">
        <span />
        <span>Sounds human</span>
        <span>Sounds synthetic</span>
      </div>
      {cells.map((row, r) => (
        <div className="vk-matrix-row" key={r}>
          <span className="vk-matrix-label">
            {r === 0 ? "Voice matches a contact" : "No match"}
          </span>
          {row.map((c) => (
            <span
              key={c.k}
              className={`vk-matrix-cell${cell === c.k ? " is-active" : ""}${
                c.k === "clone_of_known_person" ? " is-target" : ""}`}
            >
              {c.t}
            </span>
          ))}
        </div>
      ))}
      <p className="vk-matrix-note">
        The top-right cell is the attack this project exists for. A voice
        matcher alone calls it genuine; a synthesis detector alone cannot say
        whose voice it is. Only both together identify a cloned family member.
      </p>
    </div>
  );
}

function Layers({ layers }) {
  const rows = [
    ["Synthesis", layers.synthesis, "is the voice machine-made"],
    ["Identity", layers.identity, layers.identity_matched ? "matches an enrolled contact" : "no enrolled match"],
    ["Script", layers.script, "fraud playbook language"],
    ["Context", layers.context, "caller metadata"]
  ];
  return (
    <div className="vk-layers">
      {rows.map(([name, val, hint]) => (
        <div className="vk-layer" key={name}>
          <div className="vk-layer-top">
            <span>{name}</span>
            <b>{Math.round((val || 0) * 100)}%</b>
          </div>
          <div className="vk-layer-bar">
            <i style={{ width: `${Math.round((val || 0) * 100)}%` }} />
          </div>
          <small>{hint}</small>
        </div>
      ))}
    </div>
  );
}

export default function VerdictPanel({ result, challengePrompt, recordId, onAction }) {
  const [answer, setAnswer] = useState("");
  const [challengeState, setChallengeState] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!result) {
    return (
      <div className="vk-empty">
        Record the caller and press Analyse. Four signals are scored, and the
        result tells you what to do next.
      </div>
    );
  }

  const v = result.verdict;
  const band = BANDS[v.band] || BANDS.low;

  async function submitChallenge() {
    if (!answer.trim() || !challengePrompt) return;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/challenges/${challengePrompt.contactId}/verify`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId: challengePrompt.challengeId,
                                 given: answer, recordId }) });
      const d = await r.json();
      setChallengeState(d);
    } catch {
      setChallengeState({ passed: false, message: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vk-panel">
      <div className="vk-verdict" style={{ background: band.bg, borderColor: band.color }}>
        <p className="vk-headline">{v.headline}</p>
        <p className="vk-risk" style={{ color: band.color }}>
          RISK {Math.round(v.risk * 100)}% · {band.label}
        </p>
        <p className="vk-cell">{v.cell_label}</p>
      </div>

      <p className="vk-cell-detail">{v.cell_detail}</p>

      <Matrix cell={v.cell} />
      <Layers layers={v.layers} />

      {v.reasons?.length > 0 && (
        <>
          <h4 className="vk-h">Why</h4>
          <ul className="vk-reasons">
            {v.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </>
      )}

      {challengePrompt && !challengeState && (
        <div className="vk-challenge">
          <h4 className="vk-h">Ask them this, out loud</h4>
          <p className="vk-question">{challengePrompt.question}</p>
          <p className="vk-hint">
            A cloned voice can copy the sound perfectly and still cannot know
            the answer.
          </p>
          <div className="vk-challenge-row">
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type what they said"
              onKeyDown={(e) => e.key === "Enter" && submitChallenge()}
            />
            <button onClick={submitChallenge} disabled={busy || !answer.trim()}>
              {busy ? "Checking…" : "Check"}
            </button>
          </div>
        </div>
      )}

      {challengeState && (
        <div className={`vk-challenge-result ${challengeState.passed ? "is-pass" : "is-fail"}`}>
          {challengeState.message}
        </div>
      )}

      {v.actions?.length > 0 && (
        <>
          <h4 className="vk-h">What to do now</h4>
          {v.actions.map((a) => (
            <button
              key={a.id}
              className={`vk-action${a.primary ? " is-primary" : ""}`}
              onClick={() => onAction?.(a.id)}
            >
              <b>{a.label}</b>
              <small>{a.detail}</small>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
