"""
The verdict engine — five layers, and the matrix that ties two of them together.

Every single layer here is beatable on its own:

  1 synthesis   is the voice machine-made?     beaten by a new cloning tool
  2 identity    is it who the number claims?   beaten by a good clone
  3 script      is this the fraud playbook?    beaten by a patient caller
  4 context     is the caller suspicious?      beaten by a spoofed number
  5 challenge   can they answer a family fact? beaten only by someone who knows it

Beating all five at once is a different problem from beating any one.

The contribution is layer 1 crossed with layer 2:

                    not synthetic        synthetic
  identity match    genuine call         CLONE OF A KNOWN PERSON
  no match          wrong person         generic TTS spam

The top-right cell is the actual attack, and neither layer finds it alone.
The identity matcher says "yes, that is your son". The synthesis detector
says "but that voice was generated". Only together do they say "someone has
cloned your son's voice".
"""
from dataclasses import dataclass, field, asdict
import hashlib
import hmac
import re

W_SYNTH = 0.35
W_IDENT = 0.20
W_SCRIPT = 0.30
W_CONTEXT = 0.15


# ----------------------------------------------------------------- context

@dataclass
class CallContext:
    unknown_number: bool = False
    first_contact: bool = False
    voip_origin: bool = False
    foreign_code: bool = False
    number_reported_before: bool = False
    claims_known_person: bool = False

    def score(self):
        w = {"unknown_number": 0.15, "first_contact": 0.10, "voip_origin": 0.15,
             "foreign_code": 0.15, "number_reported_before": 0.30,
             "claims_known_person": 0.25}
        hits = [k for k, v in asdict(self).items() if v]
        return min(1.0, sum(w[k] for k in hits)), hits


CONTEXT_TEXT = {
    "unknown_number": "number is not in your contacts",
    "first_contact": "this number has never called you before",
    "voip_origin": "call is coming over the internet, not a phone network",
    "foreign_code": "international number",
    "number_reported_before": "this number was reported by other users",
    "claims_known_person": "claims to be someone you know, from an unknown number",
}


# --------------------------------------------------------------- challenge

def _norm(s: str) -> str:
    """Answers are spoken, so compare loosely: case, spacing, punctuation."""
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def hash_answer(answer: str, salt: str) -> str:
    """
    Stored hashed, never in plain text. A challenge bank in the clear is a
    list of the exact facts an attacker needs.
    """
    return hmac.new(salt.encode(), _norm(answer).encode(), hashlib.sha256).hexdigest()


def check_answer(given: str, stored_hash: str, salt: str) -> bool:
    return hmac.compare_digest(hash_answer(given, salt), stored_hash)


# ----------------------------------------------------------------- verdict

MATRIX = {
    ("match", "synthetic"): (
        "clone_of_known_person",
        "Cloned voice of someone you know",
        "The voice matches an enrolled contact AND shows signs of machine "
        "generation. This is the pattern of a targeted cloning attack.",
        0.42),
    ("match", "human"): (
        "genuine", "Voice matches an enrolled contact",
        "No sign of synthesis and the voice matches the enrolled profile.",
        -0.18),
    ("match", "unverified"): (
        "match_unverified", "Voice matches, synthesis not checked",
        "The voice matches an enrolled contact, but the synthesis detector "
        "was unavailable, so a clone cannot be ruled out.",
        0.0),
    ("no_match", "unverified"): (
        "unknown_unverified", "Not a known voice, synthesis not checked",
        "Not an enrolled contact, and the synthesis detector was unavailable.",
        0.05),
    ("no_match", "synthetic"): (
        "synthetic_stranger", "Machine-generated voice, not a known contact",
        "Consistent with an automated scam or robocall campaign.",
        0.22),
    ("no_match", "human"): (
        "unknown_human", "Unrecognised human voice",
        "A real person, but not one you have enrolled.",
        0.0),
}


@dataclass
class Verdict:
    risk: float
    band: str
    headline: str
    cell: str
    cell_label: str
    cell_detail: str
    layers: dict = field(default_factory=dict)
    reasons: list = field(default_factory=list)
    actions: list = field(default_factory=list)
    challenge: dict = field(default_factory=dict)


def decide(synthesis: dict, identity: dict, script: dict,
           ctx: CallContext, challenge_result: str = "not_asked") -> Verdict:
    """
    challenge_result: 'passed' | 'failed' | 'not_asked'
    """
    syn = float(synthesis.get("score", 0.0))
    sim = float(identity.get("best", {}).get("similarity", 0.0)) if identity.get("best") else 0.0
    matched = bool(identity.get("matched"))
    scr = float(script.get("risk", 0.0))
    ctx_score, ctx_hits = ctx.score()

    # identity contributes risk only when someone CLAIMS to be a contact and
    # the voice does not match — an unenrolled stranger is not itself a fraud
    ident_risk = (1.0 - sim) if (ctx.claims_known_person and not matched) else 0.0

    # Weights are renormalised over the layers that actually reported. If the
    # synthesis model is unavailable, its 35% must not silently contribute
    # zero — that would make a missing detector look like evidence of safety.
    # We average over the evidence we have, not the evidence we wish we had.
    parts = []
    if synthesis.get("available", True):
        parts.append((W_SYNTH, syn))
    if ctx.claims_known_person and identity.get("best") is not None:
        parts.append((W_IDENT, ident_risk))
    parts.append((W_SCRIPT, scr))
    parts.append((W_CONTEXT, ctx_score))
    total_w = sum(w for w, _ in parts) or 1.0
    risk = sum(w * v for w, v in parts) / total_w

    # ---- the matrix ----
    # If the synthesis model is unavailable we must NOT record "sounds human".
    # Silence is not evidence of safety, and telling someone their caller is
    # verified when nothing was checked is the worst failure this system has.
    if not synthesis.get("available", True):
        voice_axis = "unverified"
    elif syn >= 0.55:
        voice_axis = "synthetic"
    else:
        voice_axis = "human"

    cell, cell_label, cell_detail, adj = MATRIX[(("match" if matched else "no_match"),
                                                 voice_axis)]

    # The "genuine" discount only applies when the OTHER layers are also calm.
    # A voice that matches an enrolled contact while running the fraud script
    # is not reassuring — either the clone evaded layer 1, or a real family
    # member is being coerced. Both deserve the alert.
    if adj < 0 and (scr >= 0.35 or ctx_score >= 0.45):
        adj = 0.0
    risk += adj

    # agreement bonus: two independent layers both high is far more telling
    # than one layer maxed out alone
    if syn >= 0.6 and scr >= 0.6:
        risk += 0.12

    # false-positive guard: a synthetic reading with a clean script and a
    # known caller is probably an IVR or a recording, not a fraud
    if syn >= 0.7 and scr < 0.2 and ctx_score < 0.3 and not ctx.claims_known_person:
        risk *= 0.7

    # ---- layer 5 overrides everything ----
    if challenge_result == "passed":
        risk = min(risk, 0.20)
    elif challenge_result == "failed":
        risk = max(risk, 0.90)

    risk = float(max(0.0, min(1.0, risk)))
    band = ("high" if risk >= 0.75 else "elevated" if risk >= 0.5
            else "watch" if risk >= 0.3 else "low")

    headline = {
        "high": "Likely scam call — do not send money",
        "elevated": "Suspicious call — verify before you act",
        "watch": "Some warning signs — stay careful",
        "low": "No warning signs detected",
    }[band]
    if cell == "clone_of_known_person" and band in ("high", "elevated"):
        headline = "This may be a cloned voice of someone you know"
    elif cell == "genuine" and band in ("elevated", "high"):
        headline = "Voice matches, but this call looks like a scam script"
    if challenge_result == "failed":
        headline = "Caller could not answer your security question"
    elif challenge_result == "passed":
        headline = "Caller answered your security question correctly"

    # ---- reasons ----
    reasons = []
    if syn >= 0.5:
        for r in synthesis.get("reasons", [])[:2]:
            reasons.append(f"Voice: {r.get('reason', r)}")
    if ctx.claims_known_person and identity.get("best"):
        b = identity["best"]
        if matched:
            reasons.append(f"Identity: voice matches {b['name']} ({sim:.0%} similarity)")
        else:
            reasons.append(f"Identity: does not match any enrolled contact "
                           f"(closest {b['name']}, {sim:.0%})")
    for name, val in sorted(script.get("scores", {}).items(),
                            key=lambda kv: kv[1], reverse=True)[:2]:
        if val >= 0.4:
            reasons.append(f"Script: {name.replace('_', ' ')}")
    for h in ctx_hits[:2]:
        reasons.append(f"Caller: {CONTEXT_TEXT[h]}")
    if challenge_result == "failed":
        reasons.insert(0, "Challenge: gave the wrong answer to your family question")
    elif challenge_result == "passed":
        reasons.insert(0, "Challenge: answered your family question correctly")

    return Verdict(
        risk=round(risk, 3), band=band, headline=headline,
        cell=cell, cell_label=cell_label, cell_detail=cell_detail,
        layers={"synthesis": round(syn, 3), "identity": round(sim, 3),
                "identity_matched": matched, "script": round(scr, 3),
                "context": round(ctx_score, 3), "challenge": challenge_result},
        reasons=reasons,
        actions=actions_for(band, cell, challenge_result),
        challenge={"should_ask": band in ("elevated", "high") and challenge_result == "not_asked",
                   "result": challenge_result})


def actions_for(band: str, cell: str, challenge_result: str) -> list:
    """Detection without a next step is useless to a frightened person."""
    if band == "low" and challenge_result != "failed":
        return []

    acts = []
    if challenge_result == "not_asked" and band in ("elevated", "high"):
        acts.append({
            "id": "challenge",
            "label": "Ask them your security question",
            "detail": "A fact only your real family knows. A cloned voice can "
                      "copy the sound perfectly and still cannot answer this.",
            "primary": True})
    acts += [
        {"id": "callback", "label": "Hang up and call back on the saved number",
         "detail": "Dials the number stored in your contacts, not the one calling you."},
        {"id": "notify", "label": "Alert a trusted family member",
         "detail": "Sends them this call's details so you are not deciding alone."},
    ]
    if band == "high" or cell == "clone_of_known_person":
        acts.append({"id": "report", "label": "Report to 1930 cybercrime helpline",
                     "detail": "Files the number, timestamp and artifact report."})
    return acts
