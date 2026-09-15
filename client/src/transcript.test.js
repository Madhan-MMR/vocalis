/**
 * Tests for the live transcript controller. The old version failed silently
 * when Chrome ended the session on a pause, so the restart path is the thing
 * most worth pinning down.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractResults, createTranscriber } from "./transcript.js";

function fakeEvent(entries, resultIndex = 0) {
  const results = entries.map(([transcript, isFinal]) => {
    const r = [{ transcript }];
    r.isFinal = isFinal;
    return r;
  });
  results.length = entries.length;
  return { resultIndex, results };
}

test("separates final text from interim text", () => {
  const out = extractResults(fakeEvent([["hello there ", true], ["send money", false]]));
  assert.equal(out.final, "hello there");
  assert.equal(out.interim, "send money");
});

test("ignores results before resultIndex", () => {
  const out = extractResults(fakeEvent([["old", true], ["new", true]], 1));
  assert.equal(out.final, "new");
});

class FakeRecognition {
  constructor() { FakeRecognition.instances.push(this); this.started = false; }
  start() { this.started = true; this.onstart?.(); }
  stop() { this.started = false; this.onend?.(); }
}
FakeRecognition.instances = [];

test("restarts when the browser ends the session but the user is still listening", () => {
  FakeRecognition.instances = [];
  global.window = { SpeechRecognition: FakeRecognition, location: { protocol: "https:", hostname: "app" } };
  const t = createTranscriber({ onStatus() {}, onStateChange() {} });
  t.start();
  assert.equal(FakeRecognition.instances.length, 1);
  FakeRecognition.instances[0].onend();          // Chrome's silence timeout
  assert.ok(t.isRunning(), "controller should still want to listen");
  delete global.window;
});

test("stop() means stop — no restart", () => {
  FakeRecognition.instances = [];
  global.window = { SpeechRecognition: FakeRecognition, location: { protocol: "https:", hostname: "app" } };
  const t = createTranscriber({ onStatus() {}, onStateChange() {} });
  t.start();
  t.stop();
  assert.equal(t.isRunning(), false);
  delete global.window;
});

test("a denied microphone stops instead of looping", () => {
  FakeRecognition.instances = [];
  global.window = { SpeechRecognition: FakeRecognition, location: { protocol: "https:", hostname: "app" } };
  let msg = "";
  const t = createTranscriber({ onStatus: (m) => { msg = m; }, onStateChange() {} });
  t.start();
  FakeRecognition.instances[0].onerror({ error: "not-allowed" });
  assert.equal(t.isRunning(), false);
  assert.match(msg, /Microphone access is blocked/);
  delete global.window;
});
