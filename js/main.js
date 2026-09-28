/* global Easing, Premiere, document, window, localStorage */

(function () {
  const STORAGE_KEY = "keyframeEase.presets";
  const LINEAR_PRESET = Object.freeze({ id: "linear", name: "Linear", kind: "linear" });
  const DEFAULT_LIVE = { kind: "bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

  const MARGIN = 30;

  const el = {
    paramSelect: document.getElementById("paramSelect"),
    refreshBtn: document.getElementById("refreshBtn"),
    clipInfo: document.getElementById("clipInfo"),
    canvas: document.getElementById("curveCanvas"),
    curveType: document.getElementById("curveType"),
    bezierFields: document.getElementById("bezierFields"),
    amountFields: document.getElementById("amountFields"),
    x1: document.getElementById("x1"),
    y1: document.getElementById("y1"),
    x2: document.getElementById("x2"),
    y2: document.getElementById("y2"),
    amount: document.getElementById("amount"),
    presetGrid: document.getElementById("presetGrid"),
    saveForm: document.getElementById("saveForm"),
    presetName: document.getElementById("presetName"),
    saveConfirmBtn: document.getElementById("saveConfirmBtn"),
    saveCancelBtn: document.getElementById("saveCancelBtn"),
    applyBtn: document.getElementById("applyBtn"),
    status: document.getElementById("status"),
  };
  const ctx = el.canvas.getContext("2d");

  let live = Object.assign({}, DEFAULT_LIVE);
  let presets = loadPresets();
  let currentParams = []; // last result of listEasableParams
  let dragHandle = null; // 'p1' | 'p2' | null
  let selectedTileId = null;

  // ---------- persistence ----------

  function loadPresets() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function savePresets() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    } catch (e) {
      // ignore quota / privacy errors, non-fatal
    }
  }

  // ---------- status ----------

  function log(msg, type) {
    el.status.textContent = msg;
    el.status.className = type || "";
  }

  // ---------- curve editor ----------

  function toX(t) { return MARGIN + t * (el.canvas.width - 2 * MARGIN); }
  function toY(y) { return el.canvas.height - MARGIN - y * (el.canvas.height - 2 * MARGIN); }
  function fromX(px) { return (px - MARGIN) / (el.canvas.width - 2 * MARGIN); }
  function fromY(py) { return (el.canvas.height - MARGIN - py) / (el.canvas.height - 2 * MARGIN); }

  function canvasPoint(evt) {
    const rect = el.canvas.getBoundingClientRect();
    const sx = el.canvas.width / rect.width;
    const sy = el.canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * sx,
      y: (evt.clientY - rect.top) * sy,
    };
  }

  function drawCurve() {
    const w = el.canvas.width, h = el.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN, MARGIN, w - 2 * MARGIN, h - 2 * MARGIN);

    // sampled curve
    const pts = Easing.samplePreset(live, 80);
    ctx.strokeStyle = "#8fbcff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const px = toX(p.x), py = toY(p.y);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    if (live.kind === "bezier") {
      const p0 = { x: toX(0), y: toY(0) };
      const p1 = { x: toX(live.x1), y: toY(live.y1) };
      const p2 = { x: toX(live.x2), y: toY(live.y2) };
      const p3 = { x: toX(1), y: toY(1) };

      ctx.strokeStyle = "#5aa0ff";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
      ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      [p1, p2].forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#5aa0ff";
        ctx.fill();
      });

      [p0, p3].forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#d8d8d8";
        ctx.fill();
      });
    }
  }

  function drawMiniCurve(canvas, preset) {
    const c = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    c.clearRect(0, 0, w, h);
    const pts = Easing.samplePreset(preset, 30);
    c.strokeStyle = "#8fbcff";
    c.lineWidth = 1.5;
    c.beginPath();
    pts.forEach((p, i) => {
      const px = 2 + p.x * (w - 4);
      const py = h - 2 - Easing.clamp01(p.y) * (h - 4);
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    });
    c.stroke();
  }

  function syncFieldsFromLive() {
    if (live.kind === "bezier") {
      el.x1.value = live.x1; el.y1.value = live.y1;
      el.x2.value = live.x2; el.y2.value = live.y2;
    } else {
      el.amount.value = live.amount != null ? live.amount : "";
    }
  }

  function toggleFieldVisibility() {
    const isBezier = live.kind === "bezier";
    el.bezierFields.style.display = isBezier ? "grid" : "none";
    el.amountFields.style.display = isBezier ? "none" : "grid";
  }

  function setLive(next) {
    live = next;
    syncFieldsFromLive();
    toggleFieldVisibility();
    drawCurve();
  }

  // ---------- canvas dragging ----------

  el.canvas.addEventListener("mousedown", (evt) => {
    if (live.kind !== "bezier") return;
    const pt = canvasPoint(evt);
    const p1 = { x: toX(live.x1), y: toY(live.y1) };
    const p2 = { x: toX(live.x2), y: toY(live.y2) };
    const d1 = Math.hypot(pt.x - p1.x, pt.y - p1.y);
    const d2 = Math.hypot(pt.x - p2.x, pt.y - p2.y);
    if (d1 < 14 && d1 <= d2) dragHandle = "p1";
    else if (d2 < 14) dragHandle = "p2";
  });

  window.addEventListener("mousemove", (evt) => {
    if (!dragHandle) return;
    const pt = canvasPoint(evt);
    const x = Easing.clamp01(fromX(pt.x));
    const y = Math.min(1.6, Math.max(-0.6, fromY(pt.y)));
    if (dragHandle === "p1") { live.x1 = round2(x); live.y1 = round2(y); }
    else { live.x2 = round2(x); live.y2 = round2(y); }
    syncFieldsFromLive();
    drawCurve();
  });

  window.addEventListener("mouseup", () => { dragHandle = null; });

  function round2(v) { return Math.round(v * 100) / 100; }

  // ---------- form wiring ----------

  el.curveType.addEventListener("change", () => {
    const v = el.curveType.value;
    if (v === "bezier") {
      setLive({ kind: "bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 });
    } else {
      setLive({ kind: "formula", formula: v, amount: v === "elasticOut" ? 0.3 : 1.70158 });
    }
  });

  [el.x1, el.y1, el.x2, el.y2].forEach((input) => {
    input.addEventListener("input", () => {
      live.x1 = parseFloat(el.x1.value) || 0;
      live.y1 = parseFloat(el.y1.value) || 0;
      live.x2 = parseFloat(el.x2.value) || 0;
      live.y2 = parseFloat(el.y2.value) || 0;
      drawCurve();
    });
  });

  el.amount.addEventListener("input", () => {
    live.amount = parseFloat(el.amount.value);
    drawCurve();
  });

  // ---------- preset grid ----------

  function renderPresetGrid() {
    el.presetGrid.innerHTML = "";
    const all = [LINEAR_PRESET].concat(presets);

    all.forEach((preset) => {
      const tile = document.createElement("div");
      tile.className = "preset-tile" + (preset.id === selectedTileId ? " selected" : "");

      const canvas = document.createElement("canvas");
      canvas.width = 90; canvas.height = 34;
      tile.appendChild(canvas);
      drawMiniCurve(canvas, preset);

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = preset.name;
      tile.appendChild(name);

      tile.addEventListener("click", () => {
        selectedTileId = preset.id;
        if (preset.kind === "linear") {
          setLive({ kind: "linear" });
          el.bezierFields.style.display = "none";
          el.amountFields.style.display = "none";
        } else if (preset.kind === "bezier") {
          el.curveType.value = "bezier";
          setLive({ kind: "bezier", x1: preset.x1, y1: preset.y1, x2: preset.x2, y2: preset.y2 });
        } else {
          el.curveType.value = preset.formula;
          setLive({ kind: "formula", formula: preset.formula, amount: preset.amount });
        }
        renderPresetGrid();
      });

      if (preset.id !== "linear") {
        const del = document.createElement("div");
        del.className = "del";
        del.textContent = "×";
        del.title = "Supprimer";
        del.addEventListener("click", (evt) => {
          evt.stopPropagation();
          presets = presets.filter((p) => p.id !== preset.id);
          savePresets();
          renderPresetGrid();
        });
        tile.appendChild(del);
      }

      el.presetGrid.appendChild(tile);
    });

    const addTile = document.createElement("div");
    addTile.className = "preset-tile add";
    addTile.textContent = "+";
    addTile.title = "Enregistrer la courbe actuelle comme preset";
    addTile.addEventListener("click", () => {
      el.saveForm.classList.add("open");
      el.presetName.value = "";
      el.presetName.focus();
    });
    el.presetGrid.appendChild(addTile);
  }

  el.saveConfirmBtn.addEventListener("click", () => {
    const name = el.presetName.value.trim();
    if (!name) return;
    if (live.kind === "linear") { el.saveForm.classList.remove("open"); return; }
    const preset = Object.assign({ id: "p" + Date.now(), name }, live);
    presets.push(preset);
    savePresets();
    el.saveForm.classList.remove("open");
    renderPresetGrid();
  });

  el.saveCancelBtn.addEventListener("click", () => {
    el.saveForm.classList.remove("open");
  });

  // ---------- Premiere integration ----------

  async function refreshParams() {
    el.paramSelect.innerHTML = "";
    el.clipInfo.textContent = "Lecture de la sélection…";
    try {
      const { sequence } = await Premiere.getContext();
      const clip = await Premiere.getSelectedClip(sequence);
      currentParams = await Premiere.listEasableParams(clip);

      if (currentParams.length === 0) {
        el.clipInfo.textContent = "Aucune propriété animable trouvée sur ce clip.";
        return;
      }

      currentParams.forEach((p, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = p.label + (p.isTimeVarying ? ` (${p.keyframeCount} keyframes)` : " (pas encore animé)");
        el.paramSelect.appendChild(opt);
      });

      el.clipInfo.textContent = `${currentParams.length} propriété(s) animable(s).`;
    } catch (err) {
      el.clipInfo.textContent = errMsg(err);
    }
  }

  function errMsg(err) {
    return err && err.message ? err.message : String(err);
  }

  el.refreshBtn.addEventListener("click", refreshParams);

  el.applyBtn.addEventListener("click", async () => {
    log("Application en cours…");
    try {
      const { project, sequence } = await Premiere.getContext();
      const clip = await Premiere.getSelectedClip(sequence);

      const idx = el.paramSelect.value;
      if (idx === "") throw new Premiere.EaseError("Choisissez une propriété à easer.");
      const chosen = currentParams[Number(idx)];
      if (!chosen) throw new Premiere.EaseError("Propriété introuvable, cliquez sur ↻ pour rafraîchir.");

      const param = await Premiere.resolveParam(clip, chosen.componentIndex, chosen.paramIndex);
      const { prevTime, nextTime } = await Premiere.getKeyframePairAroundPlayhead(sequence, param);

      const ok = await Premiere.applyPreset({
        project, sequence, param, prevTime, nextTime,
        preset: live,
        evalPreset: Easing.evalPreset,
      });

      log(ok ? "Easing appliqué ✓" : "Échec de l'application.", ok ? "ok" : "error");
    } catch (err) {
      log(errMsg(err), "error");
    }
  });

  // ---------- init ----------

  setLive(Object.assign({}, DEFAULT_LIVE));
  renderPresetGrid();
  refreshParams();
})();
