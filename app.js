"use strict";

const ML_PER_L = 1000;
const UNIT_LABEL = { L: "л", ml: "мл", kg: "кг", g: "г" };
// Stuccos quoted in m²/kg in the catalogue convert to m²/L using a typical
// thick-paste density. AdsPro itself stores ProDens=1 placeholders for these,
// so we use a fixed assumption rather than the (zeroed-out) per-base value.
const STUCCO_DENSITY_KG_L = 1.4;
// Tuple layout for formulas in window.TICIANA_FORMULAS_P<N>; matches tools/extract_csv.py.
const F_SP = 0, F_CODE = 1, F_BASE = 2, F_FORMULA = 3, F_RGB = 4;

const state = {
  core: null,
  colorantById: null,
  baseById: null,
  formulasByProduct: {},
  currentFormulas: [],
  visibleColors: [],
};

const $ = (id) => document.getElementById(id);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function init() {
  const d = window.TICIANA_DATA;
  state.core = d;
  state.colorantById = Object.fromEntries(d.colorants.map((c) => [c.id, c]));
  state.baseById = d.bases;
  $("verLabel").textContent = d.version;

  let totalFormulas = 0;
  for (const p of d.products) {
    totalFormulas += p.subproducts.reduce((a, sp) => a + sp.n, 0);
  }
  $("totalFormulas").textContent = totalFormulas.toLocaleString("ru-RU");
  $("totalProducts").textContent = d.products.length;

  refreshProductList();

  $("product").addEventListener("change", onProductChange);
  $("subproduct").addEventListener("change", onSubproductChange);
  $("productSearch").addEventListener("input", debounce(refreshProductList, 120));
  $("baseFilter").addEventListener("change", refreshColorList);
  $("search").addEventListener("input", debounce(refreshColorList, 120));
  $("color").addEventListener("change", onColorChange);
  $("calc").addEventListener("click", calculate);
  $("areaCalc").addEventListener("click", computeFromArea);
  $("yield").addEventListener("input", () => { $("yield").dataset.userEdited = "1"; });
  $("unit").addEventListener("change", syncDensityVisibility);
  $("density").addEventListener("input", () => { $("density").dataset.userEdited = "1"; });
  syncDensityVisibility();
}

// Density input only matters when the user enters amount in kg/g (per AdsPro
// docs — for L/mL the conversion to mL is unit-only and density is unused).
// Hide the field when the unit doesn't need it; auto-fill from sp.dens[base]
// when it does, unless the user has already overridden it.
function syncDensityVisibility() {
  const unit = $("unit").value;
  const needs = unit === "kg" || unit === "g";
  $("densityLabel").hidden = !needs;
  if (needs && !$("density").dataset.userEdited) {
    const sp = currentSubproduct();
    const row = selectedRow();
    const dens = sp?.dens?.[row?.[F_BASE]];
    if (dens != null) $("density").value = dens;
  }
}

function fillSelect(sel, items, toOption) {
  const frag = document.createDocumentFragment();
  for (const it of items) {
    const o = document.createElement("option");
    Object.assign(o, toOption(it));
    frag.append(o);
  }
  sel.innerHTML = "";
  sel.append(frag);
}

function swatchEl(hex) {
  const s = document.createElement("span");
  s.className = "swatch";
  s.style.background = hex;
  return s;
}

function rgbToHex(rgb) {
  return rgb ? "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join("") : null;
}

function currentProduct() {
  return state.core.products.find((p) => p.id === $("product").value);
}

function currentSubproduct() {
  const p = currentProduct();
  if (!p) return null;
  const idx = parseInt($("subproduct").value, 10);
  return p.subproducts.find((sp) => sp.id === idx);
}

function selectedRow() {
  return state.visibleColors[$("color").selectedIndex] ?? null;
}

function refreshProductList() {
  const q = $("productSearch").value.trim().toLowerCase();
  const prev = $("product").value;
  const matches = state.core.products.filter((p) =>
    !q || p.code.toLowerCase().includes(q) || p.descr.toLowerCase().includes(q)
  );
  const totalN = (p) => p.subproducts.reduce((a, sp) => a + sp.n, 0);
  fillSelect($("product"), matches, (p) => ({
    value: p.id,
    textContent: `${p.code} (${totalN(p)})`,
  }));
  if (matches.find((p) => p.id === prev)) {
    $("product").value = prev;
  } else if (matches.length) {
    $("product").selectedIndex = 0;
    onProductChange();
  }
}

function onProductChange() {
  const p = currentProduct();
  if (!p) return;
  fillSelect($("subproduct"), p.subproducts, (sp) => ({
    value: sp.id,
    textContent: `${sp.code} — ${sp.n} формул`,
  }));
  if ($("subproduct").options.length) $("subproduct").selectedIndex = 0;
  delete $("yield").dataset.userEdited;
  delete $("density").dataset.userEdited;
  syncCoverage(p);
  ensureProductLoaded(p.id).then(onSubproductChange);
}

async function ensureProductLoaded(pid) {
  if (state.formulasByProduct[pid]) return;
  $("loadStatus").textContent = "Загрузка формул…";
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `formulas/p${pid}.js?v=${state.core.version}`;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  state.formulasByProduct[pid] = window[`TICIANA_FORMULAS_P${pid}`];
  $("loadStatus").textContent = "";
}

function onSubproductChange() {
  const p = currentProduct();
  const sp = currentSubproduct();
  if (!p || !sp) return;
  const rows = state.formulasByProduct[p.id] || [];
  state.currentFormulas = rows.filter((r) => r[F_SP] === sp.id);

  const bases = [...new Set(state.currentFormulas.map((r) => r[F_BASE]))].filter(Boolean).sort();
  fillSelect(
    $("baseFilter"),
    [{ v: "", t: "— все базы —" }, ...bases.map((b) => ({
      v: b,
      t: `${b} — ${state.baseById[b]?.descr ?? b}`,
    }))],
    (o) => ({ value: o.v, textContent: o.t })
  );
  syncCanInfo(sp);
  refreshColorList();
}

// Show which reference can the formulas in this product line are calibrated
// against — taken from ProSize[0] in tint_book.ini. AdsPro stores formulas
// per reference can; everything else is a linear scale of those values.
function syncCanInfo(sp) {
  const refSize = sp?.sizes?.[0];
  const unit = sp?.unit || "LT";
  if (refSize == null) {
    $("canInfo").textContent = "— выберите продукт —";
    return;
  }
  const noun = unit === "KG" ? "масса базы" : "объём базы";
  $("canInfo").textContent = `Формула задана на банку ${refSize} ${unit} (${noun}).`;
}

// Coverage (m²/L or m²/kg) from the manufacturer catalogue. Auto-fills the
// 'yield' input with mid-range; user can override. Unit label switches to
// match what the catalogue specifies, so KG-only products (thick stuccos)
// don't get tagged with m²/L.
function syncCoverage(p) {
  const cov = p?.cov;
  const info = $("coverageInfo");
  const yieldInput = $("yield");
  const unitLabel = $("yieldUnit");
  if (!cov) {
    info.textContent = "— расход не задан в каталоге производителя —";
    yieldInput.value = "";
    yieldInput.placeholder = "—";
    delete yieldInput.dataset.userEdited;
    return;
  }
  // Catalogue may quote thick stuccos in m²/kg. We always show & solve in
  // m²/L so the user only deals with litres; convert via STUCCO_DENSITY_KG_L.
  unitLabel.textContent = "м²/л";
  const isMass = cov.unit === "m2_per_kg";
  const minL = isMass ? cov.min * STUCCO_DENSITY_KG_L : cov.min;
  const maxL = isMass ? cov.max * STUCCO_DENSITY_KG_L : cov.max;
  const range = minL.toFixed(1) === maxL.toFixed(1)
    ? minL.toFixed(1)
    : `${minL.toFixed(1)}–${maxL.toFixed(1)}`;
  const note = isMass
    ? ` (исходно ${cov.min}–${cov.max} м²/кг, ρ=${STUCCO_DENSITY_KG_L} кг/л)`
    : "";
  info.textContent = `Расход по каталогу: ${range} м²/л на 1 слой${note}.`;
  if (!yieldInput.dataset.userEdited) {
    yieldInput.value = ((minL + maxL) / 2).toFixed(2);
  }
}

// Solve for amount given area: amount = (area * coats / yield) * (1 + reserve%).
// Result is always litres (yield input is normalised to m²/L by syncCoverage).
function computeFromArea() {
  const area = parseFloat($("area").value);
  const coats = Math.max(1, parseInt($("coats").value, 10) || 1);
  const y = parseFloat($("yield").value);
  const reserve = Math.max(0, parseFloat($("reserve").value) || 0);
  if (!(area > 0) || !(y > 0)) return;

  const needed = (area * coats / y) * (1 + reserve / 100);
  $("amount").value = needed.toFixed(2);
  $("unit").value = "L";
}

function refreshColorList() {
  const q = $("search").value.trim().toLowerCase();
  const baseFilter = $("baseFilter").value;
  const matches = state.currentFormulas.filter((r) => {
    if (baseFilter && r[F_BASE] !== baseFilter) return false;
    if (q && !r[F_CODE].toLowerCase().includes(q)) return false;
    return true;
  });
  state.visibleColors = matches.slice(0, 2000);
  fillSelect($("color"), state.visibleColors, (r) => ({
    value: r[F_CODE],
    textContent: `${r[F_CODE]} · база ${r[F_BASE]}`,
  }));
  if ($("color").options.length) $("color").selectedIndex = 0;
  onColorChange();
}

function onColorChange() {
  const row = selectedRow();
  const hex = rgbToHex(row?.[F_RGB]);
  document.body.style.setProperty("--selected-color", hex || "transparent");
  document.body.classList.toggle("has-color", !!hex);
  // Refresh density auto-fill: it may depend on the colour's base.
  syncDensityVisibility();
}

function parseFormula(str) {
  return str.split(";").map((part) => {
    const [cid, amt] = part.split(":");
    return { cid, amount: parseFloat(amt) };
  }).filter((it) => it.cid && it.amount > 0);
}

function calculate() {
  const row = selectedRow();
  if (!row) return;
  const code = row[F_CODE];
  const baseCode = row[F_BASE];
  const fstr = row[F_FORMULA];
  const rgb = row[F_RGB];
  const sp = currentSubproduct();
  const p = currentProduct();
  if (!sp) return;

  const amount = parseFloat($("amount").value);
  if (!(amount > 0)) return;
  const unit = $("unit").value; // L | ml | kg | g
  // Density input is shown only for kg/g; for L/mL it's ignored.
  const userDensity = parseFloat($("density").value) || 1.0;

  // Reference can size from ProSize[0]. Most products quote it in litres;
  // a few (mass-based stuccos) quote KG — convert to mL via the per-base
  // ProDens from tint_book.ini (falls back to 1.0 for legacy placeholders).
  const refUnit = sp.unit || "LT";
  const refSize = sp.sizes?.[0] ?? 0.9;
  const refDensity = sp.dens?.[baseCode] ?? 1.0;
  const refMl = refUnit === "KG"
    ? (refSize * ML_PER_L) / refDensity
    : refSize * ML_PER_L;
  const targetMl =
      unit === "L"  ? amount * ML_PER_L
    : unit === "ml" ? amount
    : unit === "kg" ? (amount * ML_PER_L) / userDensity
    : unit === "g"  ? amount / userDensity
    :                 0;

  // ProMult from tint_book.ini: per-base strength correction (e.g. Fondo 1 base A = 1.26).
  const mult = sp.mult?.[baseCode] ?? 1.0;
  const factor = (targetMl / refMl) * mult;

  const items = parseFormula(fstr);
  const tbody = $("result").querySelector("tbody");
  tbody.innerHTML = "";
  const totals = { ml: 0, g: 0 };

  for (const it of items) {
    const c = state.colorantById[it.cid];
    const ml = it.amount * factor;
    const g = ml * (c?.density ?? 1.1);
    totals.ml += ml;
    totals.g += g;
    tbody.append(renderRow(c?.code ?? it.cid, c?.descr ?? "—", c?.hex ?? "#ccc", ml, g));
  }

  $("totMl").textContent = totals.ml.toFixed(2);
  $("totG").textContent = totals.g.toFixed(2);

  const hex = rgbToHex(rgb) ?? "#bbb";
  const nameCell = $("resColorName");
  nameCell.innerHTML = "";
  nameCell.append(swatchEl(hex), document.createTextNode(`${code} · база ${baseCode}`));

  $("resLabel").textContent = `${amount} ${UNIT_LABEL[unit]}`;
  $("resProduct").textContent = `${p.code} / ${sp.code}`;
  $("baseName").textContent = `${baseCode} — ${state.baseById[baseCode]?.descr ?? "?"}`;
  $("canName").textContent = `${refSize} ${refUnit}`;
  $("multName").textContent = mult.toFixed(2);
  $("colorSwatch").style.background = hex;

  const card = $("resultCard");
  card.hidden = false;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderRow(code, name, hex, ml, g) {
  const tr = document.createElement("tr");
  const tdCode = document.createElement("td");
  tdCode.append(swatchEl(hex), document.createTextNode(code));
  const tdName = document.createElement("td");
  tdName.textContent = name;
  const cells = [ml.toFixed(3), g.toFixed(3)].map((v) => {
    const td = document.createElement("td");
    td.className = "num";
    td.textContent = v;
    return td;
  });
  tr.append(tdCode, tdName, ...cells);
  return tr;
}

init();
