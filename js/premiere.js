/* global require, module */

// Thin wrapper around the `premierepro` UXP host module. Every exported
// function here talks directly to Premiere; js/main.js never touches
// `ppro` itself so the UI code stays testable/readable on its own.

const ppro = require("premierepro");

const MAX_BAKED_FRAMES = 600; // ~10-20s at common frame rates; a sane ceiling.

class EaseError extends Error {}

async function getContext() {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new EaseError("Aucun projet Premiere Pro actif.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new EaseError("Aucune séquence active. Ouvrez une séquence.");
  return { project, sequence };
}

async function getSelectedClip(sequence) {
  const selection = await sequence.getSelection();
  const items = await selection.getTrackItems();
  if (!items || items.length === 0) {
    throw new EaseError("Sélectionnez un clip dans la timeline.");
  }
  if (items.length > 1) {
    throw new EaseError("Sélectionnez un seul clip à la fois.");
  }
  return items[0];
}

// Walk the clip's effect stack and list every parameter that supports
// keyframes, so the panel can offer a "Position", "Scale"... picker without
// hardcoding component indices (which vary per effect stack).
async function listEasableParams(clip) {
  const chain = await clip.getComponentChain();
  const componentCount = chain.getComponentCount();
  const out = [];

  for (let ci = 0; ci < componentCount; ci++) {
    const component = chain.getComponentAtIndex(ci);
    const componentName = await component.getDisplayName();
    const paramCount = component.getParamCount();

    for (let pi = 0; pi < paramCount; pi++) {
      const param = component.getParam(pi);
      let supported = false;
      try {
        supported = await param.areKeyframesSupported();
      } catch (e) {
        supported = false;
      }
      if (!supported) continue;

      let varying = false;
      let keyCount = 0;
      try {
        varying = param.isTimeVarying();
        if (varying) {
          const keys = await param.getKeyframeListAsTickTimes();
          keyCount = keys ? keys.length : 0;
        }
      } catch (e) {
        // leave defaults
      }

      out.push({
        componentIndex: ci,
        paramIndex: pi,
        componentName,
        paramName: param.displayName,
        label: `${componentName} — ${param.displayName}`,
        isTimeVarying: varying,
        keyframeCount: keyCount,
      });
    }
  }

  return out;
}

async function resolveParam(clip, componentIndex, paramIndex) {
  const chain = await clip.getComponentChain();
  const component = chain.getComponentAtIndex(componentIndex);
  return component.getParam(paramIndex);
}

function sortTicks(ticks) {
  return [...ticks].sort((a, b) => a.ticksNumber - b.ticksNumber);
}

// Finds the pair of existing keyframes that straddle the current playhead
// (or the nearest pair, if the playhead sits outside the keyframed range).
// There is no API to read which keyframes are selected in the Effect
// Controls UI, so the playhead position is the interaction point: park it
// between the two keyframes you want eased, then Apply.
async function getKeyframePairAroundPlayhead(sequence, param) {
  const rawTicks = await param.getKeyframeListAsTickTimes();
  const ticks = sortTicks(rawTicks || []);

  if (ticks.length < 2) {
    throw new EaseError(
      "Cette propriété a besoin d'au moins 2 keyframes pour appliquer un easing."
    );
  }

  const playhead = await sequence.getPlayerPosition();
  const p = playhead.ticksNumber;

  let i = 0;
  while (i < ticks.length - 2 && ticks[i + 1].ticksNumber <= p) i++;
  // ticks[i] / ticks[i+1] now bracket the playhead (or are the nearest pair
  // if the playhead is outside the keyframed range entirely).

  return { prevTime: ticks[i], nextTime: ticks[i + 1] };
}

function isPointLike(v) {
  return v && typeof v.x === "number" && typeof v.y === "number";
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

async function readValue(param, time) {
  const kf = param.getKeyframePtr(time);
  return kf.value.value;
}

// Applies a preset between prevTime and nextTime on `param`.
// - "linear" is free: just flips both endpoints to LINEAR interpolation.
// - Any other curve is baked: sampled once per frame and written as a run
//   of LINEAR keyframes, since Premiere's scripting API has no way to set
//   custom bezier handle values on a keyframe (only discrete interpolation
//   modes). One frame = one sample, so the render is exact, not an
//   approximation.
async function applyPreset({ project, sequence, param, prevTime, nextTime, preset, evalPreset }) {
  const prevVal = await readValue(param, prevTime);
  const nextVal = await readValue(param, nextTime);
  const LINEAR = ppro.Constants.InterpolationMode.LINEAR;

  if (preset.kind === "linear") {
    let ok = false;
    project.lockedAccess(() => {
      ok = project.executeTransaction((compoundAction) => {
        compoundAction.addAction(
          param.createSetInterpolationAtKeyframeAction(prevTime, LINEAR, false)
        );
        compoundAction.addAction(
          param.createSetInterpolationAtKeyframeAction(nextTime, LINEAR, false)
        );
      }, "Ease: Linear");
    });
    return ok;
  }

  const sequenceSettings = await sequence.getSettings();
  const frameRate = await sequenceSettings.getVideoFrameRate();

  const durationSeconds = nextTime.subtract(prevTime).seconds;
  const frameCount = Math.round(durationSeconds * frameRate.value);

  if (frameCount < 2) {
    throw new EaseError("Les deux keyframes sont trop proches (moins de 2 frames d'écart).");
  }
  if (frameCount > MAX_BAKED_FRAMES) {
    throw new EaseError(
      `Segment trop long (${frameCount} frames). Ce plugin est prévu pour des transitions courtes (≤ ${MAX_BAKED_FRAMES} frames).`
    );
  }

  const oneFrame = ppro.TickTime.createWithFrameAndFrameRate(1, frameRate);

  let ok = false;
  project.lockedAccess(() => {
    ok = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(
        param.createSetInterpolationAtKeyframeAction(prevTime, LINEAR, false)
      );

      let t = prevTime;
      for (let f = 1; f < frameCount; f++) {
        t = t.add(oneFrame);
        const frac = f / frameCount;
        const eased = evalPreset(preset, frac);

        const value = isPointLike(prevVal)
          ? new ppro.PointF(lerp(prevVal.x, nextVal.x, eased), lerp(prevVal.y, nextVal.y, eased))
          : lerp(prevVal, nextVal, eased);

        const kf = param.createKeyframe(value);
        kf.position = t;

        compoundAction.addAction(param.createAddKeyframeAction(kf));
        compoundAction.addAction(
          param.createSetInterpolationAtKeyframeAction(t, LINEAR, false)
        );
      }

      compoundAction.addAction(
        param.createSetInterpolationAtKeyframeAction(nextTime, LINEAR, false)
      );
    }, `Ease: ${preset.name || preset.kind}`);
  });

  return ok;
}

const api = {
  EaseError,
  getContext,
  getSelectedClip,
  listEasableParams,
  resolveParam,
  getKeyframePairAroundPlayhead,
  applyPreset,
};

// UXP wraps <script src> files as CommonJS modules, but fall back to a
// plain global too in case a given panel context doesn't wrap this file.
if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
window.Premiere = api;
