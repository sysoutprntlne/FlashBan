import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, relativeLuminance, MAX_REPORTED_RATE } from '../engine/detector.js';

const W = 32, H = 18, N = W * H, BIG = 1280 * 720;

function grayFor(L) {
  let best = 0;
  for (let v = 0; v < 256; v++) {
    if (Math.abs(relativeLuminance(v, v, v) - L) < Math.abs(relativeLuminance(best, best, best) - L)) best = v;
  }
  return best;
}

function frame(valueAt) {
  const px = new Uint8ClampedArray(N * 4);
  for (let p = 0; p < N; p++) {
    const v = valueAt(p);
    px.set([v, v, v, 255], p * 4);
  }
  return px;
}

// Square-wave flashing at `hz` full cycles per second, sampled at `fps` (integer phase math).
function runSquare(det, { hz, seconds = 3, fps = 60, lo = 0, hi = 255, inRegion = () => true,
  areaPx = BIG, t0 = 0, phase = 0 }) {
  let maxFps = 0, anyViolation = false, firstViolationT = null, last;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    const t = t0 + (i * 1000) / fps;
    const on = Math.floor(((i + phase) * 2 * hz) / fps) % 2 === 1;
    const v = on ? hi : lo;
    last = det.push({ t, pixels: frame((p) => (inRegion(p) ? v : lo)), areaPx });
    maxFps = Math.max(maxFps, last.flashesPerSecond);
    if (last.violation && firstViolationT === null) firstViolationT = t - t0;
    anyViolation ||= last.violation;
  }
  return { maxFps, anyViolation, firstViolationT, last, endT: t0 + ((frames - 1) * 1000) / fps };
}

test('relative luminance uses sRGB linearisation', () => {
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.ok(Math.abs(relativeLuminance(255, 255, 255) - 1) < 1e-12);
  assert.ok(Math.abs(relativeLuminance(128, 128, 128) - 0.2158605) < 1e-6);
  assert.ok(Math.abs(relativeLuminance(255, 0, 0) - 0.2126) < 1e-12);
});

test('standard preset: 3 flashes/s passes, 4 flashes/s violates', () => {
  const three = runSquare(createDetector({ preset: 'standard' }), { hz: 3 });
  assert.equal(three.maxFps, 3);
  assert.equal(three.anyViolation, false);

  const four = runSquare(createDetector({ preset: 'standard' }), { hz: 4 });
  assert.equal(four.maxFps, 4);
  assert.equal(four.anyViolation, true);
  assert.equal(four.last.severity, 'block');
  assert.equal(four.last.reason, 'flashing');
  assert.equal(four.last.areaPct, 100);
});

test('strict preset (default) flags 3 flashes/s but not 2', () => {
  assert.equal(runSquare(createDetector(), { hz: 3 }).anyViolation, true);
  const two = runSquare(createDetector(), { hz: 2 });
  assert.equal(two.maxFps, 2);
  assert.equal(two.anyViolation, false);
});

test('violation is detected within the 1250 ms warmup budget from a fresh start', () => {
  for (let phase = 0; phase < 20; phase++) {
    const strict = runSquare(createDetector(), { hz: 3, seconds: 1.5, phase });
    assert.ok(strict.firstViolationT !== null && strict.firstViolationT < 1250, `strict phase ${phase}`);
    const std = runSquare(createDetector({ preset: 'standard' }), { hz: 4, seconds: 1.5, phase });
    assert.ok(std.firstViolationT !== null && std.firstViolationT < 1250, `standard phase ${phase}`);
  }
});

test('partial area: small flashing region warns, large region blocks', () => {
  const small = runSquare(createDetector({ preset: 'standard' }), {
    hz: 5, areaPx: 100000, inRegion: (p) => p < N * 0.1,
  });
  assert.equal(small.anyViolation, false);
  assert.equal(small.last.severity, 'warn');
  assert.equal(small.last.reason, 'small-area');
  assert.ok(small.last.areaPx < 21800);

  const half = runSquare(createDetector({ preset: 'standard' }), {
    hz: 5, areaPx: 100000, inRegion: (p) => p < N / 2,
  });
  assert.equal(half.anyViolation, true);
  assert.equal(half.last.areaPct, 50);
  assert.equal(half.last.areaPx, 50000);

  const tinyElement = runSquare(createDetector(), { hz: 6, areaPx: 20000 });
  assert.equal(tinyElement.anyViolation, false);
  assert.equal(tinyElement.last.severity, 'warn');
});

test('slow ramps, low contrast and bright-only flicker are not counted', () => {
  const det = createDetector();
  let worst = 0;
  for (let i = 0; i < 360; i++) { // 6 s of a 0.5 Hz full-range triangle ramp
    const t = (i * 1000) / 60;
    const phase = (t % 2000) / 1000;
    const v = Math.round(255 * (phase < 1 ? phase : 2 - phase));
    const r = det.push({ t, pixels: frame(() => v), areaPx: BIG });
    assert.equal(r.violation, false);
    worst = Math.max(worst, r.flashesPerSecond);
  }
  assert.ok(worst <= 1);

  const lowContrast = runSquare(createDetector(), { hz: 10, lo: grayFor(0.2), hi: grayFor(0.28) });
  assert.equal(lowContrast.maxFps, 0);

  const bright = runSquare(createDetector(), { hz: 10, lo: grayFor(0.85), hi: 255 });
  assert.equal(bright.maxFps, 0);

  const justEnough = runSquare(createDetector(), { hz: 10, lo: grayFor(0.3), hi: grayFor(0.45) });
  assert.equal(justEnough.anyViolation, true);
});

test('flashes expire from the sliding 1000 ms window', () => {
  const det = createDetector();
  const run = runSquare(det, { hz: 4, seconds: 2 });
  assert.equal(run.last.violation, true);
  let r;
  for (let t = run.endT + 50; t <= run.endT + 1100; t += 50) r = det.push({ t, pixels: frame(() => 0), areaPx: BIG });
  assert.equal(r.violation, false);
  assert.equal(r.flashesPerSecond, 0);
});

test('timestamps: backwards or non-finite fail closed without corrupting state; reset clears', () => {
  const det = createDetector();
  const run = runSquare(det, { hz: 4, seconds: 2 });
  for (const t of [run.endT - 1, NaN, Infinity, '5', undefined]) {
    const r = det.push({ t, pixels: frame(() => 0), areaPx: BIG });
    assert.equal(r.violation, true);
    assert.equal(r.severity, 'block');
    assert.equal(r.reason, 'unreadable');
    assert.equal(r.flashesPerSecond, null);
    assert.equal(r.areaPct, null);
  }
  const same = det.push({ t: run.endT, pixels: frame(() => 0), areaPx: BIG });
  assert.equal(same.reason, 'flashing'); // equal timestamp accepted, history intact
  const before = same.samples;

  det.reset();
  const fresh = det.push({ t: 0, pixels: frame(() => 255), areaPx: BIG });
  assert.equal(fresh.samples, 1);
  assert.ok(before > 1);
  assert.equal(fresh.violation, false);
  assert.equal(fresh.flashesPerSecond, 0);
});

test('invalid input fails closed', () => {
  const det = createDetector();
  const good = frame(() => 0);
  const bad = [
    undefined, null, 42, 'frame',
    { t: 0, pixels: new Uint8ClampedArray(10), areaPx: BIG },
    { t: 0, pixels: Array.from(good), areaPx: BIG },
    { t: 0, pixels: new Uint8Array(N * 4), areaPx: BIG },
    { t: 0, pixels: good, areaPx: -1 },
    { t: 0, pixels: good, areaPx: NaN },
    { t: 0, pixels: good, areaPx: Infinity },
    { t: 0, pixels: good, areaPx: '100' },
    { t: 0, get pixels() { throw new Error('boom'); }, areaPx: BIG },
  ];
  for (const f of bad) {
    const r = det.push(f);
    assert.equal(r.violation, true);
    assert.equal(r.reason, 'unreadable');
    assert.equal(r.samples, 0);
  }
  assert.equal(det.push({ t: 0, pixels: good, areaPx: BIG }).reason, 'clear');
});

test('invalid configuration is rejected', () => {
  for (const opts of [
    { width: 0 }, { width: 1.5 }, { height: -2 }, { width: 300 }, { width: 100, height: 100 },
    { width: '32' }, { preset: 'lax' }, { preset: 'toString' }, { minAreaPx: -1 }, { minAreaPx: NaN },
  ]) {
    assert.throws(() => createDetector(opts), RangeError, JSON.stringify(opts));
  }
  const one = createDetector({ width: 1, height: 1 });
  assert.equal(one.push({ t: 0, pixels: new Uint8ClampedArray(4), areaPx: BIG }).reason, 'clear');
});

test('very fast flicker is reported at the bounded rate cap and still violates', () => {
  const det = createDetector();
  let r;
  for (let i = 0; i < 600; i++) r = det.push({ t: (i * 1000) / 60, pixels: frame(() => (i % 2 ? 255 : 0)), areaPx: BIG });
  assert.equal(r.flashesPerSecond, MAX_REPORTED_RATE);
  assert.equal(r.violation, true);
});
