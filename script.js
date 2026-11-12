/* Ian Randall — squishy balloon page. Original code. */
(() => {
  "use strict";

  const TEXT = "Ian Randall's mail domain   \u2022   Not much else to see here   \u2022   Stay a while and play if you like";
  const RING = TEXT + "   \u2022   ";
  const N = 72;                 // soft-body perimeter points
  const TAU = Math.PI * 2;
  const MIN_RATIO = 0.42;       // how far (fraction of radius) the centre may get to a wall
  const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const THEMES = [
    { a: [0.030, 0.030, 0.070], b: [0.150, 0.090, 0.300], c: [0.060, 0.260, 0.380], ink: [244, 241, 234] },
    { a: [0.060, 0.020, 0.020], b: [0.360, 0.090, 0.050], c: [0.520, 0.260, 0.060], ink: [255, 226, 196] },
    { a: [0.010, 0.050, 0.040], b: [0.040, 0.250, 0.200], c: [0.250, 0.420, 0.150], ink: [220, 255, 232] },
    { a: [0.050, 0.020, 0.070], b: [0.360, 0.060, 0.300], c: [0.100, 0.150, 0.520], ink: [255, 222, 246] },
    { a: [0.040, 0.040, 0.045], b: [0.170, 0.170, 0.190], c: [0.320, 0.300, 0.280], ink: [255, 255, 255] },
    { a: [0.000, 0.040, 0.080], b: [0.000, 0.220, 0.380], c: [0.500, 0.420, 0.120], ink: [236, 248, 255] },
  ];
  const BOUNCES_PER_THEME = 3;

  const bgCanvas = document.getElementById("bg");
  const fg = document.getElementById("fg");
  const ctx = fg.getContext("2d");
  const goalEl = document.querySelector(".goal");
  const hudEl = document.querySelector(".hud");
  const timerEl = document.querySelector(".hud-timer");
  const scoreEl = document.querySelector(".hud-score");
  const burstEl = document.querySelector(".burst");
  const hintEl = document.querySelector(".hint");
  const endEl = document.querySelector(".endcard");
  const finalScoreEl = document.querySelector(".final-score");
  const finalLabelEl = document.querySelector(".final-label");
  const boardList = document.querySelector(".board-list");
  const boardForm = document.querySelector(".board-form");
  const boardStatus = document.querySelector(".board-status");
  const initialInputs = Array.from(boardForm.querySelectorAll("input"));
  const saveBtn = boardForm.querySelector(".save");
  const replayBtn = document.querySelector(".replay");
  const doneBtn = document.querySelector(".done");

  let W = 0, H = 0, DPR = 1;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => performance.now() / 1000;

  /* ------------------------------------------------------------------ colour */
  let themeIndex = 0;
  const col = { a: THEMES[0].a.slice(), b: THEMES[0].b.slice(), c: THEMES[0].c.slice(), ink: THEMES[0].ink.slice() };
  let bouncesSinceTheme = 0;
  function nextTheme() {
    themeIndex = (themeIndex + 1) % THEMES.length;
    bouncesSinceTheme = 0;
  }
  function stepColours(dt) {
    const t = THEMES[themeIndex];
    const k = 1 - Math.exp(-dt * 2.6);
    for (const key of ["a", "b", "c", "ink"]) for (let i = 0; i < 3; i++) col[key][i] = lerp(col[key][i], t[key][i], k);
  }
  const inkCss = (alpha = 1) => `rgba(${col.ink[0] | 0},${col.ink[1] | 0},${col.ink[2] | 0},${alpha})`;

  /* ------------------------------------------------------------------ audio */
  const Sound = (() => {
    let ac = null, master = null, noise = null, sq = null;
    let lastP = 0;
    function init() {
      if (ac) { if (ac.state === "suspended") ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ac = new AC(); } catch { return; }
      master = ac.createGain();
      master.gain.value = 0.75;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      buildSqueeze();
    }
    // Rubber squeak: buzzy oscillator pair through a resonant band-pass,
    // chopped by a "stick-slip" pulse LFO, level driven by pressure.
    function buildSqueeze() {
      const o1 = ac.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 190;
      const o2 = ac.createOscillator(); o2.type = "square"; o2.frequency.value = 193;
      const g2 = ac.createGain(); g2.gain.value = 0.35;
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 5;
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
      const chop = ac.createGain(); chop.gain.value = 0.55;
      const lfo = ac.createOscillator(); lfo.type = "square"; lfo.frequency.value = 30;
      const lfoAmt = ac.createGain(); lfoAmt.gain.value = 0.45;
      lfo.connect(lfoAmt); lfoAmt.connect(chop.gain);
      const out = ac.createGain(); out.gain.value = 0;
      o1.connect(bp); o2.connect(g2); g2.connect(bp); bp.connect(lp); lp.connect(chop); chop.connect(out); out.connect(master);
      o1.start(); o2.start(); lfo.start();
      sq = { o1, o2, bp, lfo, out };
    }
    function squeeze(p, dt) {
      if (!sq) return;
      const t = ac.currentTime;
      const rate = dt > 0 ? Math.abs(p - lastP) / dt : 0;
      lastP = p;
      let level = 0;
      if (p > 0.03) level = Math.min(1, 0.18 * p + Math.min(0.9, rate * 0.55)) * (0.35 + 0.65 * p);
      const wobble = 1 + (Math.random() - 0.5) * 0.04;
      const f = (150 + 320 * p + Math.min(120, rate * 40)) * wobble;
      sq.out.gain.setTargetAtTime(level * 0.3, t, 0.035);
      sq.o1.frequency.setTargetAtTime(f, t, 0.03);
      sq.o2.frequency.setTargetAtTime(f * 1.012, t, 0.03);
      sq.bp.frequency.setTargetAtTime(650 + 1700 * p, t, 0.05);
      sq.lfo.frequency.setTargetAtTime(16 + 46 * p + Math.min(40, rate * 12), t, 0.05);
    }
    function silence() { if (sq) sq.out.gain.setTargetAtTime(0, ac.currentTime, 0.03); lastP = 0; }
    function noiseBurst(t, dur, gain, type, freq, q = 0.7) {
      const src = ac.createBufferSource(); src.buffer = noise;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t, Math.random() * 0.2); src.stop(t + dur + 0.05);
    }
    function tone(t, type, f0, f1, dur, gain) {
      const o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    }
    function pop() {
      if (!ac) return;
      const t = ac.currentTime;
      noiseBurst(t, 0.16, 0.9, "highpass", 900);
      noiseBurst(t, 0.06, 0.6, "bandpass", 3200, 1.2);
      tone(t, "sine", 210, 38, 0.18, 0.7);
      for (let i = 0; i < 5; i++) noiseBurst(t + 0.03 + Math.random() * 0.25, 0.02, 0.08, "bandpass", 2000 + Math.random() * 3000, 3);
    }
    function bounce(strength) {
      if (!ac) return;
      const s = clamp(strength, 0, 1);
      const t = ac.currentTime;
      tone(t, "sine", 120 + 60 * s, 55, 0.14, 0.12 + 0.35 * s);
      noiseBurst(t, 0.05, 0.03 + 0.08 * s, "lowpass", 900);
    }
    function goal() {
      if (!ac) return;
      const t = ac.currentTime;
      tone(t, "triangle", 660, 660, 0.18, 0.25);
      tone(t + 0.09, "triangle", 990, 990, 0.3, 0.22);
    }
    function blip(f = 520) { if (ac) tone(ac.currentTime, "sine", f, f * 0.98, 0.09, 0.12); }
    const api = { init, squeeze, silence, pop, bounce, goal, blip };
    // never let a blocked/broken audio stack throw into game or UI code
    for (const k of Object.keys(api)) { const fn = api[k]; api[k] = (...a) => { try { fn(...a); } catch {} }; }
    return api;
  })();
  const unlockAudio = () => Sound.init();
  window.addEventListener("pointerdown", unlockAudio, { capture: true });
  window.addEventListener("keydown", unlockAudio, { capture: true });
  window.addEventListener("touchend", unlockAudio, { capture: true });

  /* ------------------------------------------------------------------ shader background */
  const Bg = (() => {
    let gl = null, prog = null, uni = {};
    const SCALE = 0.5;
    const vs = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
    const fs = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec3 ca,cb,cc;uniform vec2 ball;uniform float press;
float h(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*45758.31);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return v;}
void main(){float m=min(r.x,r.y);vec2 p=(gl_FragCoord.xy-.5*r)/m;float s=t*.035;
vec2 q=vec2(fb(p*1.3+vec2(s,-s*.6)),fb(p*1.3+vec2(-s*.8,s)+4.2));
float k=fb(p*1.1+q*1.8+vec2(s*.5,s*.3));
vec3 c=mix(ca,cb,smoothstep(.28,.82,k));
c=mix(c,cc,smoothstep(.45,.95,q.y*k*1.7));
vec2 bp=(ball-.5*r)/m;float d=length(p-bp);
c+=cc*(.18+.5*press)*exp(-d*d*5.);
c*=.45+.55*smoothstep(1.4,.15,length(p));
c+=(h(gl_FragCoord.xy+fract(t))-.5)*.012;
gl_FragColor=vec4(c,1.);}`;
    function init() {
      try { gl = bgCanvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false }); } catch { gl = null; }
      if (!gl) return false;
      const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      try {
        prog = gl.createProgram();
        gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs));
        gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
      } catch (e) { gl = null; return false; }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const u of ["r", "t", "ca", "cb", "cc", "ball", "press"]) uni[u] = gl.getUniformLocation(prog, u);
      return true;
    }
    function resize() {
      if (!gl) return;
      bgCanvas.width = Math.max(1, Math.round(W * SCALE * Math.min(DPR, 2)));
      bgCanvas.height = Math.max(1, Math.round(H * SCALE * Math.min(DPR, 2)));
      gl.viewport(0, 0, bgCanvas.width, bgCanvas.height);
    }
    function draw(time, bx, by, press) {
      if (!gl) {
        // 2D fallback: plain dark gradient
        const c2 = bgCanvas.getContext("2d");
        if (!c2) return;
        bgCanvas.width = W; bgCanvas.height = H;
        const g = c2.createRadialGradient(bx, by, 0, W / 2, H / 2, Math.max(W, H));
        const f = (v) => (v * 255) | 0;
        g.addColorStop(0, `rgb(${f(col.b[0])},${f(col.b[1])},${f(col.b[2])})`);
        g.addColorStop(1, `rgb(${f(col.a[0])},${f(col.a[1])},${f(col.a[2])})`);
        c2.fillStyle = g; c2.fillRect(0, 0, W, H);
        return;
      }
      const sx = bgCanvas.width / W;
      gl.uniform2f(uni.r, bgCanvas.width, bgCanvas.height);
      gl.uniform1f(uni.t, time);
      gl.uniform3fv(uni.ca, col.a); gl.uniform3fv(uni.cb, col.b); gl.uniform3fv(uni.cc, col.c);
      gl.uniform2f(uni.ball, bx * sx, (H - by) * sx);
      gl.uniform1f(uni.press, press);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return { init, resize, draw };
  })();
  const hasGL = Bg.init();

  /* ------------------------------------------------------------------ text metrics */
  const chars = Array.from(RING);
  let charW = [], charOff = [], ringWidth = 0; // measured at 100px
  function measure() {
    ctx.font = `500 100px ${FONT_STACK}`;
    charW = chars.map((c) => ctx.measureText(c).width);
    charOff = []; let acc = 0;
    for (const w of charW) { charOff.push(acc + w / 2); acc += w; }
    ringWidth = acc;
  }

  /* ------------------------------------------------------------------ balloon state */
  const dirX = new Float32Array(N), dirY = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = (i / N) * TAU; dirX[i] = Math.cos(a); dirY[i] = Math.sin(a); }
  const ball = {
    x: 0, y: 0, vx: 0, vy: 0,
    baseR: 150, R: 150, targetR: 150,
    r: new Float32Array(N), rv: new Float32Array(N), d: new Float32Array(N),
    spin: -Math.PI / 2, spinV: 0.06,
    pressure: 0, popCharge: 0, contact: [false, false, false, false],
    ax: 0, ay: 0,
  };
  let state = "ball"; // ball | popped | reforming
  const drag = { on: false, id: null, ox: 0, oy: 0, px: 0, py: 0, hist: [], downT: 0, downX: 0, downY: 0, moved: 0, overshoot: 0 };
  let lastTap = { t: 0, x: 0, y: 0 };
  let layout = []; // last drawn char positions
  let particles = [], shreds = [];
  let popT = 0, reformT = 0;

  function resize() {
    W = window.innerWidth; H = window.innerHeight; DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    fg.width = Math.round(W * DPR); fg.height = Math.round(H * DPR);
    Bg.resize();
    const base = clamp(Math.min(W, H) * 0.31, 105, 250);
    const ratio = ball.baseR ? base / ball.baseR : 1;
    ball.baseR = base;
    ball.targetR = hockey.on ? base * 0.55 : base;
    ball.R *= ratio;
    for (let i = 0; i < N; i++) ball.r[i] *= ratio;
    if (!ball.x) { ball.x = W / 2; ball.y = H / 2; }
    ball.x = clamp(ball.x, ball.R, W - ball.R); ball.y = clamp(ball.y, ball.R, H - ball.R);
    updateGoalGeometry();
  }

  /* walls for a ball at x,y of radius r: returns {L,R,T,B} */
  function walls(x, y, r) {
    const inset = fontSize() * 0.6;
    let L = inset, Rr = W - inset, T = inset, B = H - inset;
    if (hockey.on) {
      if (y < r * 0.98 && x > hockey.gx0 && x < hockey.gx1) { L = hockey.gx0; Rr = hockey.gx1; T = -1e7; }
      else if (x - r >= hockey.gx0 && x + r <= hockey.gx1) T = -1e7;
    }
    return { L, R: Rr, T, B };
  }

  function rayDistances(wl) {
    for (let i = 0; i < N; i++) {
      const cx = dirX[i], cy = dirY[i];
      let t = 1e9;
      if (cx > 1e-6) t = Math.min(t, (wl.R - ball.x) / cx); else if (cx < -1e-6) t = Math.min(t, (wl.L - ball.x) / cx);
      if (cy > 1e-6) t = Math.min(t, (wl.B - ball.y) / cy); else if (cy < -1e-6) t = Math.min(t, (wl.T - ball.y) / cy);
      ball.d[i] = Math.max(2, t);
    }
  }

  const SIN_STEP = Math.sin(TAU / N);
  function areaAt(s) {
    let a = 0;
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; a += Math.min(s, ball.d[i]) * Math.min(s, ball.d[j]); }
    return 0.5 * SIN_STEP * a;
  }
  // radius of the unconstrained part so the squashed balloon keeps (roughly) its area
  function bulgeRadius(R) {
    const target = 0.5 * N * SIN_STEP * R * R;
    let lo = R, hi = R * 1.55;
    if (areaAt(lo) >= target - 1) return R;
    if (areaAt(hi) < target) return hi;
    for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (areaAt(m) < target) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  function compression(wl, x, y, R) {
    const span = R * (1 - MIN_RATIO);
    const c = [ (R - (x - wl.L)) / span, (R - (wl.R - x)) / span, (R - (y - wl.T)) / span, (R - (wl.B - y)) / span ].map((v) => clamp(v, 0, 1.2));
    const mx = Math.max(...c), sum = c.reduce((p, v) => p + v, 0);
    return { c, p: clamp(mx * 0.72 + sum * 0.28, 0, 1.25) };
  }

  /* ------------------------------------------------------------------ physics */
  const K_WALL = 1050, C_WALL = 9.5;
  function stepFree(dt) {
    const R = ball.R;
    const fr = hockey.on ? 0.3 : 0.6;
    let ax = 0, ay = 0;
    const wl = walls(ball.x, ball.y, R);
    const dist = [ball.x - wl.L, wl.R - ball.x, ball.y - wl.T, wl.B - ball.y];
    const nx = [1, -1, 0, 0], ny = [0, 0, 1, -1];
    for (let w = 0; w < 4; w++) {
      const pen = R - dist[w];
      const vn = ball.vx * nx[w] + ball.vy * ny[w]; // positive = moving away from wall
      if (pen > 0) {
        if (!ball.contact[w]) {
          ball.contact[w] = true;
          const speed = -vn;
          if (speed > 230) onBounce(speed);
        }
        let f = K_WALL * pen - C_WALL * vn;
        if (f < 0) f = 0;
        ax += f * nx[w]; ay += f * ny[w];
        // rolling: tangential speed spins the ring
        const vt = nx[w] ? ball.vy * nx[w] : -ball.vx * ny[w];
        ball.spinV = lerp(ball.spinV, -vt / R, Math.min(1, dt * 6));
        // a little wall friction
        if (nx[w]) ball.vy *= Math.exp(-1.2 * dt); else ball.vx *= Math.exp(-1.2 * dt);
      } else if (pen < -R * 0.05) ball.contact[w] = false;
    }
    ball.vx += ax * dt; ball.vy += ay * dt;
    const damp = Math.exp(-fr * dt);
    ball.vx *= damp; ball.vy *= damp;
    const sp = Math.hypot(ball.vx, ball.vy), maxV = 4200;
    if (sp > maxV) { ball.vx *= maxV / sp; ball.vy *= maxV / sp; }
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    // hard limits so it never passes through
    const lim = R * MIN_RATIO;
    const w2 = walls(ball.x, ball.y, R);
    if (ball.x < w2.L + lim) { ball.x = w2.L + lim; if (ball.vx < 0) ball.vx *= -0.5; }
    if (ball.x > w2.R - lim) { ball.x = w2.R - lim; if (ball.vx > 0) ball.vx *= -0.5; }
    if (w2.T > -1e6 && ball.y < w2.T + lim) { ball.y = w2.T + lim; if (ball.vy < 0) ball.vy *= -0.5; }
    if (ball.y > w2.B - lim) { ball.y = w2.B - lim; if (ball.vy > 0) ball.vy *= -0.5; }
    ball.ax = lerp(ball.ax, ax, 0.3); ball.ay = lerp(ball.ay, ay, 0.3);
  }

  function stepDrag(dt) {
    const R = ball.R;
    const tx = drag.px + drag.ox, ty = drag.py + drag.oy;
    const lim = R * MIN_RATIO;
    let minY = 0;
    if (hockey.on) minY = H * 0.5; // must fling the puck towards the goal
    const wl = walls(tx, Math.max(ty, minY), R);
    let cx = clamp(tx, wl.L + lim, wl.R - lim);
    let cy = clamp(ty, Math.max(minY, wl.T > -1e6 ? wl.T + lim : -1e7), wl.B - lim);
    drag.overshoot = hockey.on ? 0 : Math.hypot(tx - cx, ty - cy);
    const px = ball.x, py = ball.y;
    // slight smoothing so it feels like it has mass
    const k = 1 - Math.exp(-dt * 38);
    ball.x = lerp(ball.x, cx, k); ball.y = lerp(ball.y, cy, k);
    const vx = (ball.x - px) / dt, vy = (ball.y - py) / dt;
    ball.ax = lerp(ball.ax, (vx - ball.vx) / dt, 0.15); ball.ay = lerp(ball.ay, (vy - ball.vy) / dt, 0.15);
    ball.vx = vx; ball.vy = vy;
    for (let w = 0; w < 4; w++) ball.contact[w] = false;
    const wl2 = walls(ball.x, ball.y, R);
    const dist = [ball.x - wl2.L, wl2.R - ball.x, ball.y - wl2.T, wl2.B - ball.y];
    for (let w = 0; w < 4; w++) if (dist[w] < R) ball.contact[w] = true;
  }

  function stepShape(dt, t) {
    const R = ball.R;
    const wl = walls(ball.x, ball.y, R);
    rayDistances(wl);
    const s = bulgeRadius(R) * (1 + (reduceMotion ? 0 : 0.008 * Math.sin(t * 1.7)));
    const KR = 520, CR = 13;
    const axs = clamp(ball.ax, -30000, 30000), ays = clamp(ball.ay, -30000, 30000);
    const tremble = ball.popCharge > 0 ? ball.popCharge * R * 0.05 : 0;
    const tg = stepShape.tg || (stepShape.tg = new Float32Array(N));
    for (let i = 0; i < N; i++) tg[i] = Math.min(s, ball.d[i]);
    // round off the sharp corners where the skin meets two walls
    for (let pass = 0; pass < 4; pass++)
      for (let i = 0; i < N; i++) tg[i] = Math.min(tg[i], 0.5 * (tg[(i + 1) % N] + tg[(i + N - 1) % N]) + R * 0.006);
    for (let i = 0; i < N; i++) {
      let target = tg[i];
      if (tremble) target += (Math.random() - 0.5) * tremble;
      const inertial = -(axs * dirX[i] + ays * dirY[i]) * 0.0009; // lag behind accelerations
      const a = KR * (target - ball.r[i]) - CR * ball.rv[i] + inertial * KR * 0.02;
      ball.rv[i] += a * dt;
    }
    // smooth neighbours so it reads like one skin
    const tmp = Float32Array.from(ball.rv);
    for (let i = 0; i < N; i++) ball.rv[i] = tmp[i] * 0.8 + 0.1 * (tmp[(i + 1) % N] + tmp[(i + N - 1) % N]);
    for (let i = 0; i < N; i++) {
      ball.r[i] += ball.rv[i] * dt;
      if (ball.r[i] > ball.d[i]) { ball.r[i] = ball.d[i]; if (ball.rv[i] > 0) ball.rv[i] = 0; }
      if (ball.r[i] < R * 0.25) ball.r[i] = R * 0.25;
    }
  }

  function onBounce(speed) {
    const s = clamp((speed - 200) / 2400, 0, 1);
    Sound.bounce(s);
    try { if (s > 0.25) navigator.vibrate?.(6); } catch {}
    if (!hockey.on) {
      bouncesSinceTheme++;
      if (bouncesSinceTheme >= BOUNCES_PER_THEME) nextTheme();
    }
    // a kick of wobble on impact
    for (let i = 0; i < N; i++) ball.rv[i] += (Math.random() - 0.5) * speed * 0.05;
  }

  /* ------------------------------------------------------------------ pop + particles */
  function pop() {
    if (state !== "ball") return;
    state = "popped"; popT = now();
    Sound.silence(); Sound.pop();
    try { navigator.vibrate?.([12, 30, 8]); } catch {}
    drag.on = false; fg.classList.remove("grabbing");
    const cx = ball.x, cy = ball.y;
    particles = layout.map((L) => {
      const dx = L.x - cx, dy = L.y - cy, d = Math.hypot(dx, dy) || 1;
      const sp = 500 + Math.random() * 900;
      return {
        ch: L.ch, w: L.w, size: L.size, x: L.x, y: L.y, a: L.a,
        vx: (dx / d) * sp + (Math.random() - 0.5) * 300 + ball.vx * 0.3,
        vy: (dy / d) * sp - 300 - Math.random() * 400 + ball.vy * 0.3,
        va: (Math.random() - 0.5) * 22, rest: false, fx: 0, fy: 0, fa: 0, delay: 0,
      };
    });
    shreds = [];
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU, sp = 300 + Math.random() * 900;
      shreds.push({ x: cx + Math.cos(a) * ball.R * 0.9, y: cy + Math.sin(a) * ball.R * 0.9, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, a: Math.random() * TAU, va: (Math.random() - 0.5) * 30, len: 6 + Math.random() * 14, life: 1 });
    }
    resetPile();
    ball.popCharge = 0; ball.pressure = 0;
    themeIndex = (themeIndex + 1) % THEMES.length; bouncesSinceTheme = 0;
  }

  const COL = 4;
  let pile = new Float32Array(1);
  function resetPile() { pile = new Float32Array(Math.ceil(W / COL) + 2); }
  function extent(p) {
    const side = Math.abs(Math.round(p.a / (Math.PI / 2))) % 2 === 1;
    const hw = (side ? p.size * 0.72 : p.w) / 2, hh = (side ? p.w : p.size * 0.72) / 2;
    return { hw: Math.max(2, hw), hh: Math.max(2, hh) };
  }
  function pileTop(x, hw) {
    let top = 0;
    const a = Math.max(0, Math.floor((x - hw) / COL)), b = Math.min(pile.length - 1, Math.floor((x + hw) / COL));
    for (let i = a; i <= b; i++) if (pile[i] > top) top = pile[i];
    return top;
  }
  function addToPile(x, hw, top) {
    const a = Math.max(0, Math.floor((x - hw * 0.8) / COL)), b = Math.min(pile.length - 1, Math.floor((x + hw * 0.8) / COL));
    for (let i = a; i <= b; i++) pile[i] = Math.max(pile[i], top);
  }
  function stepParticles(dt) {
    const G = 2300;
    let settled = 0;
    for (const p of particles) {
      if (p.rest) { settled++; continue; }
      p.vy += G * dt;
      p.vx *= Math.exp(-0.3 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
      const { hw, hh } = extent(p);
      if (p.x < hw) { p.x = hw; p.vx = Math.abs(p.vx) * 0.5; }
      if (p.x > W - hw) { p.x = W - hw; p.vx = -Math.abs(p.vx) * 0.5; }
      const ground = H - pileTop(p.x, hw);
      if (p.y + hh > ground) {
        p.y = ground - hh;
        if (p.vy > 0) p.vy *= -0.3;
        p.vx *= 0.75; p.va *= 0.55;
        const flat = Math.round(p.a / Math.PI) * Math.PI;
        p.a = lerp(p.a, flat, Math.min(1, dt * 12));
        if (Math.abs(p.vy) < 60 && Math.abs(p.vx) < 25) {
          p.vy = p.vx = p.va = 0; p.a = flat; p.rest = true;
          const e = extent(p);
          p.y = ground - e.hh;
          addToPile(p.x, e.hw, H - (p.y - e.hh));
        }
      }
    }
    for (const s of shreds) {
      s.vy += G * 0.5 * dt; s.vx *= Math.exp(-2 * dt); s.vy *= Math.exp(-1.2 * dt);
      s.x += s.vx * dt; s.y += s.vy * dt; s.a += s.va * dt; s.life -= dt * 0.8;
    }
    shreds = shreds.filter((s) => s.life > 0);
    return settled === particles.length;
  }

  function reform() {
    if (state !== "popped") return;
    state = "reforming"; reformT = now();
    // reset the balloon (invisible) at the centre so we know where letters go
    ball.x = W / 2; ball.y = hockey.on ? H * 0.75 : H / 2; ball.vx = ball.vy = 0; ball.ax = ball.ay = 0;
    for (let i = 0; i < N; i++) { ball.r[i] = ball.R; ball.rv[i] = 0; }
    const slots = computeLayout();
    particles.forEach((p, i) => {
      const s = slots[i];
      p.fx = p.x; p.fy = p.y; p.fa = p.a; p.tx = s.x; p.ty = s.y; p.ta = s.a;
      // shortest rotation
      while (p.ta - p.fa > Math.PI) p.ta -= TAU;
      while (p.ta - p.fa < -Math.PI) p.ta += TAU;
      p.delay = (i / particles.length) * 0.35 + Math.random() * 0.08;
    });
    Sound.blip(380);
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function stepReform() {
    const t = now() - reformT;
    let done = true;
    for (const p of particles) {
      const k = clamp((t - p.delay) / 0.85, 0, 1);
      if (k < 1) done = false;
      const e = ease(k);
      p.x = lerp(p.fx, p.tx, e); p.y = lerp(p.fy, p.ty, e) - Math.sin(e * Math.PI) * 60; p.a = lerp(p.fa, p.ta, e);
    }
    if (done) {
      state = "ball";
      particles = [];
      for (let i = 0; i < N; i++) { ball.r[i] = ball.R * 0.9; ball.rv[i] = ball.R * 2.2; } // springy re-inflate
      Sound.blip(620);
    }
  }

  /* ------------------------------------------------------------------ layout + drawing */
  const curve = { x: [], y: [], len: [] };
  function buildCurve() {
    const P = [];
    for (let i = 0; i < N; i++) P.push([ball.x + dirX[i] * ball.r[i], ball.y + dirY[i] * ball.r[i]]);
    const xs = [], ys = [];
    const SUB = 3;
    for (let i = 0; i < N; i++) {
      const p0 = P[(i + N - 1) % N], p1 = P[i], p2 = P[(i + 1) % N], p3 = P[(i + 2) % N];
      for (let s = 0; s < SUB; s++) {
        const t = s / SUB, t2 = t * t, t3 = t2 * t;
        for (let d = 0; d < 2; d++) {
          const v = 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3);
          (d ? ys : xs).push(v);
        }
      }
    }
    const len = [0];
    for (let i = 1; i <= xs.length; i++) {
      const j = i % xs.length;
      len.push(len[i - 1] + Math.hypot(xs[j] - xs[i - 1], ys[j] - ys[i - 1]));
    }
    curve.x = xs; curve.y = ys; curve.len = len;
  }
  function pointAt(s) {
    const L = curve.len, n = curve.x.length, total = L[n];
    s = ((s % total) + total) % total;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
    const j = (lo + 1) % n, f = (s - L[lo]) / (L[lo + 1] - L[lo] || 1);
    const x = lerp(curve.x[lo], curve.x[j], f), y = lerp(curve.y[lo], curve.y[j], f);
    return { x, y, a: Math.atan2(curve.y[j] - curve.y[lo], curve.x[j] - curve.x[lo]) };
  }
  function fontSize() { return (TAU * ball.R * 0.965) / ringWidth * 100; }
  function computeLayout() {
    buildCurve();
    const total = curve.len[curve.x.length];
    const size = fontSize();
    const out = [];
    const start = (ball.spin / TAU) * total;
    for (let i = 0; i < chars.length; i++) {
      const s = start + (charOff[i] / ringWidth) * total;
      const p = pointAt(s);
      out.push({ ch: chars[i], x: p.x, y: p.y, a: p.a, w: (charW[i] * size) / 100, size });
    }
    return out;
  }

  function drawChar(ch, x, y, a, size, alpha = 1) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.globalAlpha = alpha;
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }

  function draw(t) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = inkCss();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";

    if (state === "ball") {
      layout = computeLayout();
      // faint balloon skin
      ctx.beginPath();
      ctx.moveTo(curve.x[0], curve.y[0]);
      for (let i = 1; i < curve.x.length; i++) ctx.lineTo(curve.x[i], curve.y[i]);
      ctx.closePath();
      const g = ctx.createRadialGradient(ball.x - ball.R * 0.3, ball.y - ball.R * 0.35, ball.R * 0.05, ball.x, ball.y, ball.R * 1.2);
      g.addColorStop(0, inkCss(0.07 + ball.pressure * 0.05));
      g.addColorStop(1, inkCss(0.015));
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = inkCss();
      const size = layout.length ? layout[0].size : 16;
      ctx.font = `500 ${size.toFixed(2)}px ${FONT_STACK}`;
      for (const L of layout) drawChar(L.ch, L.x, L.y, L.a, size);
    } else {
      for (const s of shreds) {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a);
        ctx.globalAlpha = clamp(s.life, 0, 1) * 0.5;
        ctx.fillRect(-s.len / 2, -1.2, s.len, 2.4);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      for (const p of particles) {
        ctx.font = `500 ${p.size.toFixed(2)}px ${FONT_STACK}`;
        drawChar(p.ch, p.x, p.y, p.a, p.size);
      }
      if (state === "popped" && now() - popT > 1.2) {
        ctx.font = `500 13px ${FONT_STACK}`;
        ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 3);
        ctx.fillText("tap to blow it back up", W / 2, H * 0.4);
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ------------------------------------------------------------------ air hockey */
  const hockey = { on: false, gx0: 0, gx1: 0, running: false, over: false, timeLeft: 15, score: 0, started: false };
  // Round token from api/scores.php. Idle until the clock starts; "local" when there is no server.
  let ticketGen = 0, roundTicket = null, ticketPromise = null, ticketState = "idle";
  const BOARD_KEY = "ianrandall.hockey.v1";
  function updateGoalGeometry() {
    const rh = ball.baseR * 0.55;
    const gw = Math.min(W * 0.8, rh * 2 * 1.45);
    hockey.gx0 = W / 2 - gw / 2; hockey.gx1 = W / 2 + gw / 2;
    goalEl.style.width = gw + "px";
  }
  function enterHockey() {
    if (state !== "ball") return;
    hockey.on = true; hockey.running = false; hockey.over = false; hockey.started = false; hockey.timeLeft = 15; hockey.score = 0;
    clearTicket();
    cancelDrag(); closeEndCard();
    ball.targetR = ball.baseR * 0.55;
    // start clear of the bottom wall while it is still full size, or the wall spring launches it into the goal
    ball.x = W / 2; ball.y = Math.max(H * 0.5, Math.min(H * 0.75, H - ball.R - fontSize() * 0.6 - 4)); ball.vx = ball.vy = 0;
    updateGoalGeometry();
    goalEl.classList.add("on"); hudEl.hidden = false; hintEl.classList.add("show");
    renderHud(); Sound.blip(700);
  }
  // Drop any in-progress grab, including a pointer capture left over from the round.
  function cancelDrag() {
    if (drag.id != null) { try { if (fg.hasPointerCapture?.(drag.id)) fg.releasePointerCapture(drag.id); } catch {} }
    drag.on = false; drag.id = null; drag.hist = []; drag.overshoot = 0;
    fg.classList.remove("grabbing");
  }
  // Hide the end card and hand focus back to the page so nothing in the card keeps input.
  function closeEndCard() {
    endEl.hidden = true;
    if (document.activeElement && endEl.contains(document.activeElement)) document.activeElement.blur();
  }
  function exitHockey() {
    // Reset all round state: leaving `over` set blocked every later grab (see pointerdown).
    hockey.on = false; hockey.running = false; hockey.over = false; hockey.started = false;
    hockey.timeLeft = 15; hockey.score = 0;
    clearTicket();
    cancelDrag();
    ball.targetR = ball.baseR;
    goalEl.classList.remove("on"); hudEl.hidden = true; hintEl.classList.remove("show");
    closeEndCard();
    ball.vx = 0; ball.vy = -300;
    Sound.blip(420);
  }
  function renderHud() {
    const s = Math.ceil(Math.max(0, hockey.timeLeft));
    timerEl.textContent = ":" + String(s).padStart(2, "0");
    timerEl.classList.toggle("low", hockey.running && s <= 5);
    scoreEl.textContent = String(hockey.score);
  }
  function stepHockey(dt) {
    if (!hockey.on) return;
    if (hockey.running) {
      hockey.timeLeft -= dt;
      if (hockey.timeLeft <= 0) { hockey.timeLeft = 0; endRound(); }
      renderHud();
    }
    if (ball.y < -ball.R) {
      if (hockey.running) {
        hockey.score++; renderHud();
        burstEl.classList.remove("show"); void burstEl.offsetWidth; burstEl.classList.add("show");
        goalEl.classList.remove("pulse"); void goalEl.offsetWidth; goalEl.classList.add("pulse");
        Sound.goal();
        try { navigator.vibrate?.(15); } catch {}
      }
      ball.x = W / 2; ball.y = H * 0.78; ball.vx = 0; ball.vy = 0;
      for (let i = 0; i < N; i++) { ball.r[i] = ball.R * 0.6; ball.rv[i] = ball.R * 3; }
    }
  }
  // localStorage can be missing or throw (file:// in some browsers, private mode, storage full),
  // so keep an in-memory copy and use it whenever storage fails. saveBoard reports whether it persisted.
  // Even *reading* window.localStorage throws SecurityError in an opaque-origin sandboxed iframe.
  let memBoard = null;
  function store() {
    try { const s = window.localStorage; if (!s) return null; s.getItem(BOARD_KEY); return s; } catch { return null; }
  }
  function loadBoard() {
    if (memBoard) return memBoard.slice();
    try {
      const s = store(); if (!s) return [];
      const v = JSON.parse(s.getItem(BOARD_KEY) || "[]");
      return Array.isArray(v) ? v.filter((e) => e && typeof e.s === "number") : [];
    } catch { return []; }
  }
  function saveBoard(list) {
    try { const s = store(); if (s) { s.setItem(BOARD_KEY, JSON.stringify(list)); memBoard = null; return true; } } catch {}
    memBoard = list.slice(); return false;
  }
  let statusTimer = 0;
  function setStatus(msg, kind = "") {
    clearTimeout(statusTimer);
    boardStatus.textContent = msg;
    boardStatus.className = "board-status" + (kind ? " " + kind : "");
    if (kind === "error") { boardForm.classList.remove("shake"); void boardForm.offsetWidth; boardForm.classList.add("shake"); }
  }
  /* Global board: api/scores.php on the same server (only when the page is served over http/https).
     Anything else (file:// preview, no PHP, server error) falls back to the board on this device. */
  const API_URL = "api/scores.php";
  const apiPossible = /^https?:$/.test(location.protocol);
  let boardMode = "local";     // "global" once the server has answered
  let globalList = null;
  let highlight = null;        // {id} for a global entry, {d} for a local one
  let roundToken = 0;
  function clearTicket() {
    ticketGen++;
    roundTicket = null;
    ticketPromise = null;
    ticketState = "idle";
  }
  // Asked for when the clock starts. A failed fetch leaves the on-device board working.
  function requestTicket() {
    const my = ++ticketGen;
    roundTicket = null;
    ticketState = "pending";
    if (!apiPossible) { ticketState = "local"; ticketPromise = null; return; }
    ticketPromise = api("POST", { start: true }).then((r) => {
      if (my !== ticketGen) return;
      if (r && r.data && r.data.ok && typeof r.data.token === "string") {
        roundTicket = r.data.token;
        ticketState = "ok";
      } else {
        roundTicket = null;
        ticketState = "fail";
      }
    }).catch(() => {
      if (my === ticketGen) { roundTicket = null; ticketState = "fail"; }
    });
  }
  async function api(method, body) {
    if (!apiPossible) throw new Error("no server");
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 6000);
    try {
      const res = await fetch(API_URL, {
        method, credentials: "same-origin", cache: "no-store",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl ? ctl.signal : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch {}
      // a host without PHP returns 404 HTML or the raw source: treat as unreachable
      if (!data || typeof data !== "object") throw new Error("bad response");
      const known = data.ok === false || Array.isArray(data.scores) || typeof data.token === "string";
      if (!known) throw new Error("bad response");
      return { status: res.status, data };
    } finally { clearTimeout(timer); }
  }
  const cleanGlobal = (list) => list.filter((e) => e && typeof e.s === "number").map((e) => ({ id: String(e.id), i: String(e.i || "???"), s: e.s }));
  async function loadGlobal() {
    try {
      const r = await api("GET");
      if (r.data.ok && Array.isArray(r.data.scores)) { globalList = cleanGlobal(r.data.scores); boardMode = "global"; return; }
    } catch {}
    boardMode = "local";
  }
  function currentList() {
    if (boardMode === "global" && globalList) return globalList.slice(0, 20);
    return loadBoard().sort((a, b) => b.s - a.s || a.d - b.d).slice(0, 20);
  }
  const isMine = (e) => !!highlight && (highlight.id ? e.id === highlight.id : e.d === highlight.d);
  function addRow(rankNo, initials, score, mine) {
    const li = document.createElement("li");
    if (mine) li.className = "me";
    const left = document.createElement("span");
    const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = rankNo + ".";
    left.append(rank, document.createTextNode(" " + String(initials || "???").slice(0, 3)));
    const right = document.createElement("span"); right.textContent = score;
    li.append(left, right); boardList.append(li);
  }
  function renderBoard(myEntry, placeholder) {
    const list = currentList();
    boardList.innerHTML = "";
    const show = list.slice(0, 5);
    if (placeholder || !show.length) {
      const li = document.createElement("li"); li.className = "empty"; li.textContent = placeholder || "no scores yet"; boardList.append(li);
      return list;
    }
    show.forEach((e, i) => addRow(i + 1, e.i, e.s, isMine(e)));
    // your entry made the board but not the top five: show it underneath with its real rank
    if (myEntry && myEntry.rank > 5) addRow(myEntry.rank, myEntry.i, myEntry.s, true);
    return list;
  }
  function endRound() {
    hockey.running = false; hockey.over = true;
    cancelDrag();
    ball.vx *= 0.2; ball.vy *= 0.2;
    Sound.blip(300);
    finalScoreEl.textContent = hockey.score;
    finalLabelEl.textContent = hockey.score === 1 ? "goal" : "goals";
    highlight = null; saving = false; saveBtn.disabled = false;
    boardForm.hidden = true;
    initialInputs.forEach((i) => { i.value = ""; i.dataset.prev = ""; });
    setStatus("");
    renderBoard(null, apiPossible ? "loading scores…" : null);
    endEl.hidden = false;
    setTimeout(() => { if (boardForm.hidden && !endEl.hidden) replayBtn.focus(); }, 50);
    const token = ++roundToken;
    loadGlobal().then(() => {
      if (token !== roundToken || endEl.hidden) return;
      const list = renderBoard();
      const qualifies = hockey.score > 0 && (list.length < 20 || hockey.score > list[list.length - 1].s);
      boardForm.hidden = !qualifies;
      if (boardMode !== "global") setStatus(apiPossible ? "score server unreachable, showing scores on this device" : "showing scores on this device");
      if (qualifies) setTimeout(() => { if (!endEl.hidden && !boardForm.hidden) initialInputs[0].focus(); }, 30);
    });
  }
  initialInputs.forEach((inp, idx) => {
    inp.addEventListener("input", (e) => {
      const letters = inp.value.replace(/[^a-z]/gi, "").toUpperCase();
      if (boardStatus.classList.contains("error")) setStatus("");
      // a single keystroke into an already-filled box gives old letter + new letter: keep the new one.
      // Anything else multi-letter (paste, autofill, IME) is spread across the boxes.
      const prev = inp.dataset.prev || "";
      const oneKeyOverwrite = letters.length === 2 && prev.length === 1 && e.inputType === "insertText";
      if (letters.length > 1 && !oneKeyOverwrite) {
        // paste / autofill / IME: spread the letters across the boxes from here on
        let j = idx;
        for (const ch of letters) { if (j > 2) break; initialInputs[j].value = ch; initialInputs[j++].dataset.prev = ch; }
        (initialInputs.find((i) => !i.value) || saveBtn).focus();
        return;
      }
      inp.value = letters.slice(-1); inp.dataset.prev = inp.value;
      if (inp.value && idx < 2) initialInputs[idx + 1].focus();
    });
    // clicking a later box while an earlier one is empty starts typing at the first empty box
    inp.addEventListener("focus", () => {
      const firstEmpty = initialInputs.findIndex((i) => !i.value);
      if (firstEmpty !== -1 && firstEmpty < idx) initialInputs[firstEmpty].focus();
    });
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); saveScore(); return; }
      if (e.key === "Backspace" && !inp.value && idx > 0) initialInputs[idx - 1].focus();
    });
  });
  // No <form>/submit: sandboxed viewers without allow-forms (chat-app file previews) block submission
  // outright, so the submit event never fired. Save straight from the button click / Enter key.
  let saving = false;
  function saveLocal(ini, score) {
    const d = Date.now();
    let persisted = false;
    try {
      const list = loadBoard();
      list.push({ i: ini, s: score, d });
      list.sort((x, y) => y.s - x.s || x.d - y.d);
      persisted = saveBoard(list.slice(0, 20));
    } catch {
      memBoard = [...(memBoard || []), { i: ini, s: score, d }];
    }
    highlight = { d };
    const list = currentList();
    const idx = list.findIndex((e) => e.d === d);
    return { persisted, entry: { i: ini, s: score, rank: idx + 1 } };
  }
  async function saveScore() {
    if (boardForm.hidden || saving) return; // already saved / in flight
    // gaps are fine (e.g. started in the second box); 1–3 letters are accepted
    const ini = initialInputs.map((i) => (i.value || "").replace(/[^a-z]/gi, "").toUpperCase()).join("").slice(0, 3);
    if (!ini) {
      setStatus("type your initials first", "error");
      initialInputs[0].focus();
      return;
    }
    const score = hockey.score;
    const gen = ticketGen;
    let fellBack = false;
    if (boardMode === "global") {
      saving = true; saveBtn.disabled = true; setStatus("saving…");
      let r = null;
      let noTicket = false;
      try {
        if (ticketPromise) await ticketPromise;
        if (gen !== ticketGen || endEl.hidden) { saving = false; saveBtn.disabled = false; return; }
        if (!roundTicket) noTicket = true;
        else r = await api("POST", { initials: ini, score, token: roundTicket });
      } catch {}
      if (gen !== ticketGen || endEl.hidden) { saving = false; saveBtn.disabled = false; return; }
      saving = false; saveBtn.disabled = false;
      if (!noTicket && r && r.data.ok && r.data.entry && Array.isArray(r.data.scores)) {
        globalList = cleanGlobal(r.data.scores);
        const entry = r.data.entry;
        highlight = { id: String(entry.id) };
        boardForm.hidden = true;
        renderBoard(entry);
        setStatus(`saved to the global board${entry.rank ? ", #" + entry.rank : ""}. nice one ${entry.i}`, "ok");
        replayBtn.focus();
        Sound.blip(880);
        return;
      }
      if (!noTicket && r && r.status >= 400 && r.status < 500 && r.data && r.data.error) {
        // the server answered but said no (bad initials, rate limit, round token...): say why, let them try again
        setStatus(String(r.data.error), "error");
        if (r.status === 422) initialInputs[0].focus();
        return;
      }
      boardMode = "local"; fellBack = true; // no token, unreachable, or a server error
    }
    const { persisted, entry } = saveLocal(ini, score);
    boardForm.hidden = true;
    renderBoard(entry);
    const where = persisted ? "saved on this device" : "saved for this visit";
    setStatus(fellBack ? `couldn't reach the score server, ${where} only`
      : apiPossible ? `${where} (score server unreachable)` : `${where}. the global board works on the live site`, "ok");
    replayBtn.focus();
    Sound.blip(880);
  }
  saveBtn.addEventListener("click", (e) => { e.preventDefault(); saveScore(); });
  replayBtn.addEventListener("click", () => { closeEndCard(); enterHockey(); });
  doneBtn.addEventListener("click", () => exitHockey());
  endEl.addEventListener("pointerdown", (e) => e.stopPropagation());
  // Escape closes the end card like "done" (capture phase so the initials inputs can't swallow it).
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !endEl.hidden) { e.preventDefault(); e.stopPropagation(); exitHockey(); }
  }, { capture: true });

  /* ------------------------------------------------------------------ input */
  function insideBall(x, y) {
    if (state !== "ball") return false;
    const dx = x - ball.x, dy = y - ball.y, d = Math.hypot(dx, dy);
    if (d > ball.R * 1.6) return false;
    const a = ((Math.atan2(dy, dx) % TAU) + TAU) % TAU;
    const i = Math.round((a / TAU) * N) % N;
    return d <= ball.r[i] + Math.max(18, ball.R * 0.12);
  }
  fg.addEventListener("pointerdown", (e) => {
    if (state === "popped") { if (now() - popT > 0.5) reform(); return; }
    if (state !== "ball" || hockey.over) return;
    if (!insideBall(e.clientX, e.clientY)) return;
    e.preventDefault();
    fg.setPointerCapture?.(e.pointerId);
    drag.on = true; drag.id = e.pointerId;
    drag.ox = ball.x - e.clientX; drag.oy = ball.y - e.clientY;
    drag.px = e.clientX; drag.py = e.clientY;
    drag.downT = now(); drag.downX = e.clientX; drag.downY = e.clientY; drag.moved = 0;
    drag.hist = [{ t: now(), x: e.clientX, y: e.clientY }];
    ball.vx = ball.vy = 0;
    fg.classList.add("grabbing");
  });
  fg.addEventListener("pointermove", (e) => {
    if (drag.on && e.pointerId === drag.id) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) {
        drag.px = ev.clientX; drag.py = ev.clientY;
        drag.hist.push({ t: now(), x: ev.clientX, y: ev.clientY });
      }
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY));
      while (drag.hist.length > 3 && now() - drag.hist[0].t > 0.25) drag.hist.shift();
    } else {
      fg.classList.toggle("can-grab", insideBall(e.clientX, e.clientY));
    }
  });
  function release(e) {
    if (!drag.on || (e && e.pointerId !== drag.id)) return;
    drag.on = false; fg.classList.remove("grabbing");
    const tNow = now();
    const hist = drag.hist;
    let vx = 0, vy = 0;
    const b = hist[hist.length - 1];
    if (hist.length >= 2 && tNow - b.t < 0.1) {
      let ai = hist.length - 2;
      while (ai > 0 && b.t - hist[ai - 1].t <= 0.1) ai--;
      const a = hist[ai], dt = Math.max(0.012, b.t - a.t);
      vx = (b.x - a.x) / dt; vy = (b.y - a.y) / dt;
    }
    const sp = Math.hypot(vx, vy), maxV = 4000;
    if (sp > maxV) { vx *= maxV / sp; vy *= maxV / sp; }
    ball.vx = vx; ball.vy = vy;
    ball.popCharge = 0;
    if (hockey.on && !hockey.running && !hockey.over && sp > 150) {
      hockey.running = true; hockey.started = true; hintEl.classList.remove("show");
      requestTicket();
    }
    // double-tap toggles the mini-game
    const isTap = tNow - drag.downT < 0.28 && drag.moved < 12;
    if (isTap) {
      if (tNow - lastTap.t < 0.38 && Math.hypot(drag.downX - lastTap.x, drag.downY - lastTap.y) < 40) {
        lastTap.t = 0;
        if (hockey.on) exitHockey(); else enterHockey();
      } else lastTap = { t: tNow, x: drag.downX, y: drag.downY };
    }
  }
  fg.addEventListener("pointerup", release);
  fg.addEventListener("pointercancel", release);
  fg.addEventListener("lostpointercapture", release);

  window.addEventListener("keydown", (e) => {
    if (!endEl.hidden) return;
    const imp = 900;
    if (state === "popped" && (e.key === "Enter" || e.key === " ")) { reform(); e.preventDefault(); return; }
    if (state !== "ball") return;
    if (e.key === "ArrowLeft") ball.vx -= imp; else if (e.key === "ArrowRight") ball.vx += imp;
    else if (e.key === "ArrowUp") { ball.vy -= imp; if (hockey.on && !hockey.running && !hockey.over) { hockey.running = true; requestTicket(); } }
    else if (e.key === "ArrowDown") ball.vy += imp;
    else if (e.key === "h" || e.key === "H") { hockey.on ? exitHockey() : enterHockey(); }
    else if (e.key === "p" || e.key === "P") { if (!hockey.on) pop(); }
    else return;
    e.preventDefault();
  });
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => { if (document.hidden) Sound.silence(); });

  /* ------------------------------------------------------------------ main loop */
  let last = now(), t0 = last;
  function frame() {
    const tn = now();
    let dt = Math.min(0.05, tn - last); last = tn;
    const t = tn - t0;
    stepColours(dt);
    if (state === "ball") {
      ball.R = lerp(ball.R, ball.targetR, 1 - Math.exp(-dt * 9));
      const steps = Math.max(1, Math.ceil(dt / 0.004));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        if (drag.on) stepDrag(h); else stepFree(h);
        stepShape(h, t);
      }
      stepHockey(dt);
      const wl = walls(ball.x, ball.y, ball.R);
      const comp = compression(wl, ball.x, ball.y, ball.R);
      ball.pressure = lerp(ball.pressure, Math.min(1, comp.p), 1 - Math.exp(-dt * 25));
      // over-pressure → pop
      if (drag.on && !hockey.on && comp.p > 0.85 && drag.overshoot > ball.R * 0.22) {
        ball.popCharge += dt * (0.35 + Math.min(1.5, drag.overshoot / ball.R) * 0.45) * (comp.p > 1.05 ? 1.25 : 1);
        if (ball.popCharge >= 1) pop();
      } else ball.popCharge = Math.max(0, ball.popCharge - dt * 1.8);
      if (state === "ball") Sound.squeeze(Math.min(1, ball.pressure), dt);
      // ring spin: idle drift + rolling
      const idle = reduceMotion ? 0 : 0.05;
      if (!ball.contact.some(Boolean) || drag.on) ball.spinV = lerp(ball.spinV, idle, 1 - Math.exp(-dt * 0.8));
      ball.spin += ball.spinV * dt;
    } else if (state === "popped") {
      const settled = stepParticles(dt);
      if (now() - popT > (settled ? 5.5 : 9)) reform();
    } else if (state === "reforming") {
      stepReform();
    }
    Bg.draw(reduceMotion ? t * 0.2 : t, ball.x, ball.y, state === "ball" ? ball.pressure : 0);
    draw(t);
    requestAnimationFrame(frame);
  }

  measure();
  resize();
  for (let i = 0; i < N; i++) ball.r[i] = ball.R;
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure).catch(() => {});
  requestAnimationFrame(frame);

  // small read-only hook for automated testing
  window.__balloon = {
    get state() { return state; }, ball, hockey,
    get dragOn() { return drag.on; }, get theme() { return themeIndex; },
    get ticket() { return roundTicket; }, get ticketState() { return ticketState; },
    pop, reform, enterHockey, exitHockey, hasGL,
  };
})();
