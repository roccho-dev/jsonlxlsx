import { assert } from './errors.mjs';

function deepClone(obj) {
  return obj == null ? obj : JSON.parse(JSON.stringify(obj));
}

function deepMerge(parent, child) {
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return deepClone(child);
  const out = deepClone(parent);
  for (const [k, v] of Object.entries(child || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = deepClone(v);
  }
  return out;
}

function normalizeStyle(style) {
  const s = deepClone(style || {});
  if (typeof s.fill === 'string') s.fill = { color: s.fill };
  if (s.numberFormat && !s.number_format) s.number_format = s.numberFormat;
  if (s.numFmt && !s.number_format) s.number_format = s.numFmt;
  return s;
}

function createStyleCatalog(styleDefs = {}) {
  function resolve(styleRef, stack = []) {
    if (styleRef == null || styleRef === '') return {};
    if (typeof styleRef === 'string') {
      assert(Object.prototype.hasOwnProperty.call(styleDefs, styleRef), `unknown style_id: ${styleRef}`);
      assert(!stack.includes(styleRef), `cyclic style based_on chain: ${[...stack, styleRef].join(' -> ')}`);
      return resolve(styleDefs[styleRef], [...stack, styleRef]);
    }
    assert(typeof styleRef === 'object' && !Array.isArray(styleRef), `style must be a style_id or object, got ${JSON.stringify(styleRef)}`);
    let base = {};
    if (styleRef.based_on) base = resolve(styleRef.based_on, stack);
    const patch = {};
    for (const [k, v] of Object.entries(styleRef)) {
      if (!['style_id', 'based_on', 'op', 'seq', '_line', 'mode'].includes(k)) patch[k] = v;
    }
    return normalizeStyle(deepMerge(base, patch));
  }

  return Object.freeze({ resolve, normalizeStyle });
}

export { createStyleCatalog, deepClone, deepMerge };
