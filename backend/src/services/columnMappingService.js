const levenshtein = require('fast-levenshtein');
const crypto = require('crypto');
const { CANONICAL_SCHEMA, REQUIRED_FIELDS } = require('../config/canonicalSchema');

const FUZZY_THRESHOLD = 0.6;

/**
 * Normalizes a header string by converting to lowercase and stripping
 * punctuation, whitespace, underscores, hyphens, and slashes.
 */
function normalizeString(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Computes a deterministic SHA-256 signature for a set of raw headers.
 * Headers are trimmed, lowercased, and sorted alphabetically so that
 * column reordering or case differences produce the exact same signature.
 */
function computeSourceSignature(headers) {
  if (!Array.isArray(headers) || headers.length === 0) return '';
  const normalized = headers
    .map(h => String(h || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Evaluates similarity between a raw header and a single canonical field definition.
 * Returns { confidence: number, method: 'synonym' | 'fuzzy' | 'none' }
 */
function compareHeaderToField(rawHeader, fieldDef) {
  const normRaw = normalizeString(rawHeader);
  if (!normRaw) {
    return { confidence: 0, method: 'none' };
  }

  // 1. Exact match with canonical field name
  if (normRaw === normalizeString(fieldDef.field)) {
    return { confidence: 1.0, method: 'synonym' };
  }

  // 2. Exact match with any defined synonym
  if (Array.isArray(fieldDef.synonyms)) {
    for (const syn of fieldDef.synonyms) {
      if (normRaw === normalizeString(syn)) {
        return { confidence: 0.95, method: 'synonym' };
      }
    }
  }

  // 3. Fuzzy fallback using Levenshtein distance against canonical name & synonyms
  let bestFuzzySim = 0;
  const targets = [fieldDef.field, ...(fieldDef.synonyms || [])];

  for (const target of targets) {
    const normTarget = normalizeString(target);
    if (!normTarget) continue;

    const maxLen = Math.max(normRaw.length, normTarget.length);
    if (maxLen === 0) continue;

    const dist = levenshtein.get(normRaw, normTarget);
    const sim = 1 - (dist / maxLen);

    // Substring containment boost if one contains the other as a whole component
    let containSim = 0;
    if (normRaw.includes(normTarget) || normTarget.includes(normRaw)) {
      containSim = (Math.min(normRaw.length, normTarget.length) / maxLen) * 0.9;
    }

    const effectiveSim = Math.max(sim, containSim);
    if (effectiveSim > bestFuzzySim) {
      bestFuzzySim = effectiveSim;
    }
  }

  if (bestFuzzySim >= FUZZY_THRESHOLD) {
    return {
      confidence: Math.round(bestFuzzySim * 100) / 100,
      method: 'fuzzy'
    };
  }

  return { confidence: 0, method: 'none' };
}

/**
 * Evaluates a single raw header across all canonical fields and returns
 * the best match, or null if no field meets the threshold.
 */
function matchSingleHeader(rawHeader) {
  let best = null;

  for (const [canonicalField, fieldDef] of Object.entries(CANONICAL_SCHEMA)) {
    const result = compareHeaderToField(rawHeader, fieldDef);
    if (result.method !== 'none') {
      if (!best || result.confidence > best.confidence || (result.confidence === best.confidence && result.method === 'synonym' && best.method !== 'synonym')) {
        best = {
          canonical_field: canonicalField,
          raw_header: rawHeader,
          confidence: result.confidence,
          method: result.method
        };
      }
    }
  }

  return best;
}

/**
 * Suggests best-matching canonical fields for a list of raw uploaded headers.
 * Resolves competing headers greedily so each canonical field maps to at most
 * one raw header, and each raw header maps to at most one canonical field.
 *
 * @param {string[]} rawHeaders List of column header names from the CSV file
 * @returns {object} { suggestions: Array, missing_required: Array, unmapped_raw: Array }
 */
function suggestMapping(rawHeaders) {
  if (!Array.isArray(rawHeaders)) {
    return { suggestions: [], missing_required: [...REQUIRED_FIELDS], unmapped_raw: [] };
  }

  // 1. Gather all candidate pairings above threshold
  const candidates = [];
  for (const rawHeader of rawHeaders) {
    for (const [canonicalField, fieldDef] of Object.entries(CANONICAL_SCHEMA)) {
      const { confidence, method } = compareHeaderToField(rawHeader, fieldDef);
      if (method !== 'none' && confidence >= FUZZY_THRESHOLD) {
        candidates.push({
          canonical_field: canonicalField,
          raw_header: rawHeader,
          confidence,
          method
        });
      }
    }
  }

  // 2. Sort candidates:
  //    - synonym matches first (exact/synonym > fuzzy)
  //    - then higher confidence
  //    - then canonical name length
  candidates.sort((a, b) => {
    if (a.method === 'synonym' && b.method !== 'synonym') return -1;
    if (b.method === 'synonym' && a.method !== 'synonym') return 1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return 0;
  });

  // 3. Greedily assign matches (one-to-one)
  const assignedCanonical = new Set();
  const assignedRaw = new Set();
  const assignments = {};

  for (const c of candidates) {
    if (!assignedCanonical.has(c.canonical_field) && !assignedRaw.has(c.raw_header)) {
      assignedCanonical.add(c.canonical_field);
      assignedRaw.add(c.raw_header);
      assignments[c.canonical_field] = {
        suggested_raw_header: c.raw_header,
        confidence: c.confidence,
        method: c.method
      };
    }
  }

  // 4. Build output for all canonical fields
  const suggestions = [];
  const missingRequired = [];

  for (const [fieldKey, fieldDef] of Object.entries(CANONICAL_SCHEMA)) {
    const assigned = assignments[fieldKey];
    if (assigned && assigned.suggested_raw_header) {
      suggestions.push({
        canonical_field: fieldKey,
        display_label: fieldDef.display_label,
        description: fieldDef.description,
        expected_type: fieldDef.expected_type,
        required: fieldDef.required,
        suggested_raw_header: assigned.suggested_raw_header,
        confidence: assigned.confidence,
        method: assigned.method
      });
    } else {
      suggestions.push({
        canonical_field: fieldKey,
        display_label: fieldDef.display_label,
        description: fieldDef.description,
        expected_type: fieldDef.expected_type,
        required: fieldDef.required,
        suggested_raw_header: null,
        confidence: 0,
        method: 'none'
      });

      if (fieldDef.required) {
        missingRequired.push(fieldKey);
      }
    }
  }

  const unmappedRaw = rawHeaders.filter(h => !assignedRaw.has(h));

  return {
    suggestions,
    missing_required: missingRequired,
    unmapped_raw: unmappedRaw
  };
}

module.exports = {
  normalizeString,
  computeSourceSignature,
  compareHeaderToField,
  matchSingleHeader,
  suggestMapping,
  FUZZY_THRESHOLD
};
