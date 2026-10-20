"use strict";

/* ==========================================================================
   36-symbol frequency allocation (must match the Python decoder exactly)
   ========================================================================== */
const LOW  = [725, 825, 1025, 1150, 1325, 1475];
const HIGH = [1600, 1900, 2250, 2575, 2825, 3125];
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function charFreqs(ch) {
  const i = CHARS.indexOf(ch.toUpperCase());
  if (i < 0) return null;
  return [LOW[Math.floor(i / 6)], HIGH[i % 6]];
}

/* ==========================================================================
   Audio engine
   ========================================================================== */
let ctx = null;
let toneBus, noiseGain, masterGain, analyser;
let noiseSource = null;
let noiseBuffers = { white: null, pink: null };
let currentNoiseType = "white";
const activeNodes = new Set();
let playToken = 0;

function ensureAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  toneBus = ctx.createGain();
  toneBus.gain.value = 1;
  noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  masterGain = ctx.createGain();
  masterGain.gain.value = 1;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;

  toneBus.connect(masterGain);
  noiseGain.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);

  buildNoiseBuffers();
  updateAudioStatus();
  requestAnimationFrame(drawScope);
  return ctx;
}

function updateAudioStatus() {
  const led = document.getElementById("audioLed");
  const txt = document.getElementById("audioStatusText");
  const live = ctx && ctx.state === "running";
  led.classList.toggle("is-live", !!live);
  txt.textContent = live ? "audio armed" : "tap anywhere to arm audio";
}

/* -------------------------------------------------------------- tones --- */
function toneLevel()  { return document.getElementById("levelSlider").value / 100; }
function toneDurMs()  { return +document.getElementById("durSlider").value; }
function gapMs()      { return +document.getElementById("gapSlider").value; }
function devPct()     { return +document.getElementById("devSlider").value; }
function imbalanceDb(){ return +document.getElementById("imbSlider").value; }

/**
 * Schedule one tone (1, 2, or N simultaneous frequencies) starting at an
 * AudioContext time. amp is the overall peak amplitude of the sum.
 */
function scheduleTone(freqs, startTime, durationMs, amp, imbDb) {
  const durS = Math.max(durationMs, 1) / 1000;
  const atk = Math.min(0.005, durS / 4);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, startTime);
  env.gain.linearRampToValueAtTime(1, startTime + atk);
  env.gain.setValueAtTime(1, Math.max(startTime + atk, startTime + durS - atk));
  env.gain.linearRampToValueAtTime(0, startTime + durS);
  env.connect(toneBus);
  activeNodes.add(env);

  const perTone = amp / freqs.length;
  freqs.forEach((f, idx) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const g = ctx.createGain();
    let a = perTone;
    if (freqs.length === 2 && idx === 1) a *= Math.pow(10, -imbDb / 20);
    g.gain.value = a;
    osc.connect(g);
    g.connect(env);
    osc.start(startTime);
    osc.stop(startTime + durS + 0.02);
    activeNodes.add(osc);
    osc.onended = () => activeNodes.delete(osc);
  });

  setTimeout(() => activeNodes.delete(env), (startTime - ctx.currentTime + durS + 0.05) * 1000);
}

function playFreqs(freqs, durationMs) {
  ensureAudio();
  scheduleTone(freqs, ctx.currentTime, durationMs, toneLevel(), imbalanceDb());
}

function playChar(ch, durationMs) {
  const f = charFreqs(ch);
  if (!f) return;
  const [lo, hi] = f;
  const d = devPct() / 100;
  playFreqs([lo * (1 + d), hi * (1 + d)], durationMs);
}

function stopAll() {
  playToken++;
  if (!ctx) return;
  const now = ctx.currentTime;
  activeNodes.forEach((n) => {
    try {
      if (n.stop) n.stop(now);
      else n.gain.cancelScheduledValues(now), n.gain.setValueAtTime(0, now);
    } catch (e) { /* already stopped */ }
  });
  activeNodes.clear();
  setPlayingState(false);
  highlightKey(null);
  setStatusLine("idle");
}

/* ------------------------------------------------------------- noise --- */
function makeWhiteBuffer(context, seconds) {
  const len = Math.floor(context.sampleRate * seconds);
  const buf = context.createBuffer(1, len, context.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makePinkBuffer(context, seconds) {
  const len = Math.floor(context.sampleRate * seconds);
  const buf = context.createBuffer(1, len, context.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    d[i] = pink * 0.11;
  }
  return buf;
}

function buildNoiseBuffers() {
  noiseBuffers.white = makeWhiteBuffer(ctx, 4);
  noiseBuffers.pink = makePinkBuffer(ctx, 4);
}

function startNoise() {
  ensureAudio();
  stopNoiseSource();
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffers[currentNoiseType];
  src.loop = true;
  src.connect(noiseGain);
  src.start();
  noiseSource = src;
  document.getElementById("noiseToggleBtn").textContent = "Stop noise";
}

function stopNoiseSource() {
  if (noiseSource) {
    try { noiseSource.stop(); } catch (e) {}
    noiseSource.disconnect();
    noiseSource = null;
  }
}

function stopNoise() {
  stopNoiseSource();
  document.getElementById("noiseToggleBtn").textContent = "Start noise";
}

function playClickBurst() {
  ensureAudio();
  const buf = noiseBuffers.white;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const offset = Math.random() * (buf.duration - 0.05);
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(1.1, now + 0.002);
  g.gain.linearRampToValueAtTime(0, now + 0.04);
  src.connect(g);
  g.connect(masterGain);
  src.start(now, offset, 0.05);
  activeNodes.add(src);
  src.onended = () => activeNodes.delete(src);
}

/* ==========================================================================
   Message sequencing
   ========================================================================== */
function sanitize(text) {
  return text.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function setPlayingState(playing) {
  document.getElementById("playMsgBtn").disabled = playing;
  document.getElementById("randomBtn").disabled = playing;
}

function highlightKey(ch) {
  document.querySelectorAll(".key.is-playing").forEach((k) => k.classList.remove("is-playing"));
  if (ch) {
    const el = document.querySelector(`.key[data-char="${ch}"]`);
    if (el) el.classList.add("is-playing");
  }
}

function setStatusLine(text) {
  document.getElementById("scopeState").textContent = text;
}

async function playMessage(text) {
  const clean = sanitize(text);
  if (!clean.trim()) return;
  ensureAudio();
  const token = ++playToken;
  setPlayingState(true);
  const dur = toneDurMs();
  const gap = gapMs();
  for (const ch of clean) {
    if (token !== playToken) break;
    if (ch === " ") {
      highlightKey(null);
      setStatusLine("silence");
      await sleep(gap);
      continue;
    }
    const f = charFreqs(ch);
    setStatusLine(`'${ch}'  ${f[0]} / ${f[1]} Hz`);
    highlightKey(ch);
    playChar(ch, dur);
    await sleep(dur + gap);
  }
  if (token === playToken) {
    setPlayingState(false);
    highlightKey(null);
    setStatusLine("idle");
  }
}

function playRandom() {
  const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
  document.getElementById("msgInput").value = ch;
  playMessage(ch);
}

/* ==========================================================================
   Edge-case (invalid-signal) tests
   ========================================================================== */
function edgeSingle() {
  ensureAudio();
  const ch = sanitize(document.getElementById("msgInput").value)[0] || "A";
  const [lo] = charFreqs(ch);
  setStatusLine(`single tone  ${lo} Hz  (${toneDurMs()} ms) &mdash; expect INVALID`);
  playFreqs([lo], toneDurMs());
}

function edgeTriple() {
  ensureAudio();
  const ch = sanitize(document.getElementById("msgInput").value)[0] || "A";
  const [lo, hi] = charFreqs(ch);
  const extra = 2000;
  setStatusLine(`three tones  ${lo}/${hi}/${extra} Hz &mdash; expect INVALID`);
  playFreqs([lo, hi, extra], toneDurMs());
}

function edgeOutOfTable() {
  ensureAudio();
  setStatusLine("out-of-table  1000 / 2000 Hz &mdash; expect INVALID");
  playFreqs([1000, 2000], toneDurMs());
}

function edgeShort() {
  ensureAudio();
  const ch = sanitize(document.getElementById("msgInput").value)[0] || "A";
  setStatusLine(`'${ch}' forced to 80 ms &mdash; expect TOO SHORT`);
  playChar(ch, 80);
}

function edgeLong() {
  ensureAudio();
  const ch = sanitize(document.getElementById("msgInput").value)[0] || "A";
  setStatusLine(`'${ch}' forced to 1400 ms &mdash; expect OVERLONG`);
  playChar(ch, 1400);
}

/* ==========================================================================
   Oscilloscope
   ========================================================================== */
function drawScope() {
  requestAnimationFrame(drawScope);
  const canvas = document.getElementById("scopeCanvas");
  const ctx2d = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx2d.fillStyle = "#0f1113";
  ctx2d.fillRect(0, 0, w, h);

  // grid
  ctx2d.strokeStyle = "rgba(255,255,255,0.05)";
  ctx2d.lineWidth = 1;
  for (let x = 0; x <= w; x += w / 8) { ctx2d.beginPath(); ctx2d.moveTo(x, 0); ctx2d.lineTo(x, h); ctx2d.stroke(); }
  for (let y = 0; y <= h; y += h / 4) { ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(w, y); ctx2d.stroke(); }

  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  ctx2d.strokeStyle = "#5fe3a0";
  ctx2d.lineWidth = 1.5;
  ctx2d.beginPath();
  const step = w / data.length;
  for (let i = 0; i < data.length; i++) {
    const y = (data[i] / 255) * h;
    const x = i * step;
    if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();
}

/* ==========================================================================
   UI construction + wiring
   ========================================================================== */
function buildMatrix() {
  const table = document.getElementById("matrix");
  const theadRow = table.querySelector("thead tr");
  HIGH.forEach((f) => {
    const th = document.createElement("th");
    th.textContent = f;
    theadRow.appendChild(th);
  });

  const tbody = table.querySelector("tbody");
  LOW.forEach((lo, r) => {
    const tr = document.createElement("tr");
    const rh = document.createElement("th");
    rh.className = "matrix__rowhead";
    rh.textContent = lo;
    tr.appendChild(rh);
    HIGH.forEach((hi, c) => {
      const ch = CHARS[r * 6 + c];
      const td = document.createElement("td");
      const btn = document.createElement("button");
      btn.className = "key";
      btn.type = "button";
      btn.textContent = ch;
      btn.dataset.char = ch;
      btn.title = `${ch}  \u2192  ${lo} / ${hi} Hz`;
      btn.addEventListener("click", () => {
        ensureAudio();
        document.getElementById("msgInput").value = ch;
        setStatusLine(`'${ch}'  ${lo} / ${hi} Hz`);
        highlightKey(ch);
        playChar(ch, toneDurMs());
        setTimeout(() => highlightKey(null), toneDurMs());
      });
      td.appendChild(btn);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function wireSlider(id, outId, fmt) {
  const el = document.getElementById(id);
  const out = document.getElementById(outId);
  const update = () => { out.textContent = fmt(+el.value); updateSnrReadout(); };
  el.addEventListener("input", update);
  update();
}

function updateSnrReadout() {
  const toneAmp = toneLevel();
  const noiseAmp = document.getElementById("noiseSlider").value / 100;
  const out = document.getElementById("snrOut");
  if (noiseAmp <= 0.001) { out.textContent = "no noise"; return; }
  const ratioDb = 20 * Math.log10(Math.max(toneAmp, 0.001) / noiseAmp);
  out.textContent = `${ratioDb >= 0 ? "+" : ""}${ratioDb.toFixed(1)} dB`;
}

function wireUI() {
  buildMatrix();

  wireSlider("durSlider", "durOut", (v) => `${v} ms`);
  wireSlider("gapSlider", "gapOut", (v) => `${v} ms`);
  wireSlider("levelSlider", "levelOut", (v) => `${v}%`);
  wireSlider("devSlider", "devOut", (v) => `${v.toFixed(1)}%`);
  wireSlider("imbSlider", "imbOut", (v) => `${v} dB`);
  wireSlider("noiseSlider", "noiseOut", (v) => `${v}%`);

  document.getElementById("noiseSlider").addEventListener("input", (e) => {
    if (noiseGain) noiseGain.gain.value = (e.target.value / 100) * 0.6;
  });

  document.getElementById("msgInput").addEventListener("input", (e) => {
    const clean = sanitize(e.target.value);
    document.getElementById("msgPreview").textContent =
      clean ? clean.split("").map((c) => (c === " " ? "\u00b7" : c)).join(" ") : "\u00a0";
  });

  document.getElementById("playMsgBtn").addEventListener("click", () => {
    playMessage(document.getElementById("msgInput").value);
  });
  document.getElementById("randomBtn").addEventListener("click", playRandom);
  document.getElementById("stopBtn").addEventListener("click", stopAll);

  document.getElementById("edgeSingleBtn").addEventListener("click", edgeSingle);
  document.getElementById("edgeTripleBtn").addEventListener("click", edgeTriple);
  document.getElementById("edgeOutBtn").addEventListener("click", edgeOutOfTable);
  document.getElementById("edgeShortBtn").addEventListener("click", edgeShort);
  document.getElementById("edgeLongBtn").addEventListener("click", edgeLong);

  document.querySelectorAll("#noiseType .segmented__opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#noiseType .segmented__opt").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      currentNoiseType = btn.dataset.type;
      if (noiseSource) startNoise(); // swap live without needing a second click
    });
  });

  document.getElementById("noiseToggleBtn").addEventListener("click", () => {
    ensureAudio();
    if (noiseSource) stopNoise(); else startNoise();
  });
  document.getElementById("clickBtn").addEventListener("click", playClickBurst);

  document.body.addEventListener("pointerdown", ensureAudio, { once: true });

  updateSnrReadout();
}

document.addEventListener("DOMContentLoaded", wireUI);
