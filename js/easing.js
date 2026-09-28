/* global module */

// Standard CSS-style cubic-bezier solver: P0=(0,0) P1=(x1,y1) P2=(x2,y2) P3=(1,1).
// x is time (0..1), y is progress (0..1). Same math browsers use for
// `cubic-bezier()` timing functions and what most motion tools expose as
// "ease" numbers, so presets are portable and easy to reason about.
function makeCubicBezier(x1, y1, x2, y2) {
  x1 = clamp01(x1);
  x2 = clamp01(x2);

  function A(a1, a2) { return 1.0 - 3.0 * a2 + 3.0 * a1; }
  function B(a1, a2) { return 3.0 * a2 - 6.0 * a1; }
  function C(a1) { return 3.0 * a1; }

  function calcBezier(t, a1, a2) {
    return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  }

  function getSlope(t, a1, a2) {
    return 3.0 * A(a1, a2) * t * t + 2.0 * B(a1, a2) * t + C(a1);
  }

  function getTForX(x) {
    let t = x;
    // Newton-Raphson, a few iterations converge fast for well-behaved curves.
    for (let i = 0; i < 8; i++) {
      const slope = getSlope(t, x1, x2);
      if (Math.abs(slope) < 1e-6) break;
      const xEst = calcBezier(t, x1, x2) - x;
      t -= xEst / slope;
    }
    if (t >= 0 && t <= 1) return t;

    // Fallback: bisection, robust even for extreme handle placements.
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 20; i++) {
      const xEst = calcBezier(t, x1, x2);
      if (Math.abs(xEst - x) < 1e-7) break;
      if (xEst < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  }

  return function bezierEase(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const t = getTForX(x);
    return calcBezier(t, y1, y2);
  };
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// Closed-form named curves for effects a plain 4-point bezier can't express.
const FORMULAS = {
  linear: () => (t) => t,

  bounceOut: () => (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
    if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
    t -= 2.625 / d1;
    return n1 * t * t + 0.984375;
  },

  elasticOut: (amount) => {
    const a = Math.max(0.05, amount == null ? 0.3 : amount);
    const c4 = (2 * Math.PI) / a;
    return (t) => {
      if (t === 0) return 0;
      if (t === 1) return 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    };
  },

  backOut: (amount) => {
    const c1 = amount == null ? 1.70158 : amount;
    const c3 = c1 + 1;
    return (t) => {
      t -= 1;
      return 1 + c3 * t * t * t + c1 * t * t;
    };
  },

  backInOut: (amount) => {
    const c1 = amount == null ? 1.70158 : amount;
    const c2 = c1 * 1.525;
    return (t) => {
      return t < 0.5
        ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    };
  },
};

// preset shape: { id, name, kind: 'bezier'|'formula', x1,y1,x2,y2, formula, amount }
function evalPreset(preset, t) {
  t = clamp01(t);
  if (!preset) return t;
  if (preset.kind === "bezier") {
    return makeCubicBezier(preset.x1, preset.y1, preset.x2, preset.y2)(t);
  }
  if (preset.kind === "formula") {
    const factory = FORMULAS[preset.formula];
    if (!factory) return t;
    return factory(preset.amount)(t);
  }
  return t;
}

function samplePreset(preset, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: t, y: evalPreset(preset, t) });
  }
  return pts;
}

const api = { makeCubicBezier, evalPreset, samplePreset, FORMULAS, clamp01 };

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  window.Easing = api;
}
