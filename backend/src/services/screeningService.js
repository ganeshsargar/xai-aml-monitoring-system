/**
 * FundTraceAI Watchlist & Sanctions Name Screening Service
 * 
 * Implements high-precision fuzzy matching using Jaro-Winkler and Token-Set algorithms,
 * robust to word order inversion, initials ("Rahul K. Sharma" vs "Kumar Sharma Rahul"),
 * transliteration variants, and noise.
 * 
 * Regulatory Compliance Note:
 * // verify against current rules (e.g. OFAC SDN XML Schema / UN Consolidated List Specification / FIU-IND 51A UAPA List)
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const fuzz = require('fuzzball');

const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');
const { getRiskConfig } = require('../config/riskConfig');

/**
 * Pure JavaScript Jaro-Winkler distance calculation (zero dependencies, ESM-safe)
 */
function jaroWinklerDistance(s1, s2, prefixScale = 0.1) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2 || !s1.length || !s2.length) return 0.0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (!s2Matches[j] && s1[i] === s2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (s1Matches[i]) {
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
  }

  const jaro = (
    (matches / s1.length) +
    (matches / s2.length) +
    ((matches - transpositions / 2) / matches)
  ) / 3.0;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * prefixScale * (1 - jaro);
}

const WATCHLIST_DIR = path.join(__dirname, '../../data/watchlists');

// In-memory cache of parsed watchlist entries
let watchlistsCache = {
  sanctions: [],
  pep: [],
  adverse_media: [],
  loadedAt: null
};

// In-memory set of known false-positive pairs: "normalized_name|||matched_entity_id"
let falsePositiveCache = new Set();
let falsePositiveLoadedAt = 0;
const FP_CACHE_TTL_MS = 15000;

// High-performance screening memoization cache for batch ingestion
const screeningResultCache = new Map();
const MAX_SCREENING_CACHE = 10000;

function getScreeningCacheKey(name, options = {}) {
  const norm = normalizeName(name);
  const thresh = options.threshold != null ? options.threshold : 'def';
  const lists = options.lists ? options.lists.slice().sort().join(',') : 'all';
  return `${norm}:::${thresh}:::${lists}`;
}

/**
 * Transliteration & spelling normalization map
 */
const TRANSLITERATION_MAP = {
  mohd: 'mohammed',
  md: 'mohammed',
  mohamed: 'mohammed',
  muhammad: 'mohammed',
  muhammed: 'mohammed',
  bikash: 'vikas',
  bikas: 'vikas',
  ganesan: 'ganesh',
  ganeshan: 'ganesh',
  jon: 'john',
  aleksandr: 'alexander',
  alexei: 'alexey',
  dmitriy: 'dmitri',
  dmitry: 'dmitri',
  sergey: 'sergei',
  vlad: 'vladimir'
};

const COMMON_HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'shri', 'smt', 'sir', 
  'mdm', 'lord', 'sheikh', 'haji'
]);

const CORPORATE_SUFFIXES = new Set([
  'ltd', 'limited', 'pvt', 'private', 'llc', 'fze', 'inc', 'corp', 
  'corporation', 'co', 'company', 'gmbh', 'sa', 'ag', 'plc', 'dmcc'
]);

/**
 * Clean and normalize a personal or corporate name
 */
function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  
  // 1. Lowercase and strip accents/diacritics
  let norm = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 2. Replace punctuation with spaces while preserving single initials
  norm = norm.replace(/[^\w\s]/g, ' ');

  // 3. Tokenize and filter
  const rawTokens = norm.split(/\s+/).filter(Boolean);
  const filteredTokens = [];

  for (const token of rawTokens) {
    if (COMMON_HONORIFICS.has(token) && rawTokens.length > 2) {
      continue; // Skip honorific if full name has >= 2 tokens
    }
    // Apply transliteration normalization
    const mapped = TRANSLITERATION_MAP[token] || token;
    filteredTokens.push(mapped);
  }

  return filteredTokens.join(' ');
}

/**
 * Extract tokens from normalized name
 */
function tokenizeName(normalizedName) {
  return normalizedName.split(/\s+/).filter(Boolean);
}

/**
 * Initials-aware matching:
 * Handles cases like "Rahul K. Sharma" vs "Kumar Sharma Rahul",
 * or "V. M. Sterling" vs "Victor Moriarity Sterling".
 */
function calculateInitialsScore(tokens1, tokens2) {
  if (!tokens1.length || !tokens2.length) return 0;

  // Clone arrays
  const unmatched1 = [...tokens1];
  const unmatched2 = [...tokens2];

  let exactMatches = 0;
  let initialMatches = 0;

  // 1. Match full exact tokens first
  for (let i = unmatched1.length - 1; i >= 0; i--) {
    const t1 = unmatched1[i];
    const matchIdx = unmatched2.findIndex(t2 => t1 === t2);
    if (matchIdx !== -1) {
      exactMatches++;
      unmatched1.splice(i, 1);
      unmatched2.splice(matchIdx, 1);
    }
  }

  // 2. Match remaining single initials against first letters of remaining full words
  for (let i = unmatched1.length - 1; i >= 0; i--) {
    const t1 = unmatched1[i];
    if (t1.length === 1) {
      // t1 is an initial: check if any unmatched token in tokens2 starts with t1
      const matchIdx = unmatched2.findIndex(t2 => t2.length > 1 && t2.startsWith(t1));
      if (matchIdx !== -1) {
        initialMatches++;
        unmatched1.splice(i, 1);
        unmatched2.splice(matchIdx, 1);
      }
    }
  }

  // 3. Reverse check (initials in tokens2 matching full tokens in tokens1)
  for (let i = unmatched2.length - 1; i >= 0; i--) {
    const t2 = unmatched2[i];
    if (t2.length === 1) {
      const matchIdx = unmatched1.findIndex(t1 => t1.length > 1 && t1.startsWith(t2));
      if (matchIdx !== -1) {
        initialMatches++;
        unmatched2.splice(i, 1);
        unmatched1.splice(matchIdx, 1);
      }
    }
  }

  const maxTokens = Math.max(tokens1.length, tokens2.length);
  const weightedScore = (exactMatches * 1.0 + initialMatches * 0.90) / maxTokens;
  return Math.min(100, Math.round(weightedScore * 100));
}

/**
 * Compute composite fuzzy match score between candidate and target name
 */
function calculateNameSimilarity(candidateName, targetName) {
  const norm1 = normalizeName(candidateName);
  const norm2 = normalizeName(targetName);

  if (!norm1 || !norm2) return { score: 0, matchType: 'None' };
  if (norm1 === norm2) return { score: 100, matchType: 'Exact' };

  const tokens1 = tokenizeName(norm1);
  const tokens2 = tokenizeName(norm2);

  // 1. Token Set Ratio (fuzzball) - excellent for word order inversion and subsets
  const tokenSetRatio = fuzz.token_set_ratio(norm1, norm2);

  // 2. Token Sort Ratio (fuzzball) - excellent for rearranged words
  const tokenSortRatio = fuzz.token_sort_ratio(norm1, norm2);

  // 3. Jaro-Winkler Distance - robust for prefix typos and character transpositions
  const jaroWinkler = Math.round(jaroWinklerDistance(norm1, norm2) * 100);

  // 4. Initials-aware match score
  const initialsScore = calculateInitialsScore(tokens1, tokens2);

  // Determine composite score (scale Jaro-Winkler when token overlap is low to prevent false baseline inflation)
  const tokenMax = Math.max(tokenSetRatio, tokenSortRatio);
  const effectiveJaro = tokenMax >= 50 || jaroWinkler >= 80 ? jaroWinkler : Math.round(jaroWinkler * (tokenMax / 50.0));
  const maxScore = Math.max(tokenSetRatio, tokenSortRatio, effectiveJaro, initialsScore);

  let matchType = 'Fuzzy Low';
  if (maxScore >= 98) {
    matchType = 'Exact';
  } else if (initialsScore >= 85 && (tokens1.some(t => t.length === 1) || tokens2.some(t => t.length === 1))) {
    matchType = 'Initial Match';
  } else if (maxScore >= 85) {
    matchType = 'Fuzzy High';
  } else if (maxScore >= 70) {
    matchType = 'Fuzzy Medium';
  }

  return {
    score: maxScore,
    matchType,
    details: {
      tokenSetRatio,
      tokenSortRatio,
      jaroWinkler: effectiveJaro,
      rawJaroWinkler: jaroWinkler,
      initialsScore
    }
  };
}

/**
 * Parse a CSV file into a list of records
 */
function parseCsvFile(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) {
      return resolve([]);
    }
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => {
        console.error(`[Watchlist Loader Error reading ${filePath}]:`, err.message);
        resolve([]);
      });
  });
}

/**
 * Load watchlists from disk into memory
 */
async function loadWatchlists(forceReload = false) {
  const now = Date.now();
  if (!forceReload && watchlistsCache.loadedAt && (now - watchlistsCache.loadedAt < 60000)) {
    return watchlistsCache;
  }

  try {
    const sanctionsPath = path.join(WATCHLIST_DIR, 'sanctions.csv');
    const pepPath = path.join(WATCHLIST_DIR, 'pep.csv');
    const adversePath = path.join(WATCHLIST_DIR, 'adverse_media.csv');

    const [sanctions, pep, adverseMedia] = await Promise.all([
      parseCsvFile(sanctionsPath),
      parseCsvFile(pepPath),
      parseCsvFile(adversePath)
    ]);

    watchlistsCache = {
      sanctions: sanctions.map(s => ({
        ...s,
        list_type: 'Sanctions',
        aliases_list: (s.aliases || '').split(';').map(a => a.trim()).filter(Boolean)
      })),
      pep: pep.map(p => ({
        ...p,
        list_type: 'PEP',
        aliases_list: (p.aliases || '').split(';').map(a => a.trim()).filter(Boolean)
      })),
      adverse_media: adverseMedia.map(a => ({
        ...a,
        list_type: 'AdverseMedia',
        aliases_list: (a.aliases || '').split(';').map(a => a.trim()).filter(Boolean)
      })),
      loadedAt: now
    };

    return watchlistsCache;
  } catch (err) {
    console.error('[Watchlists Loader Exception]:', err.message);
    return watchlistsCache;
  }
}

/**
 * Ingest real OFAC SDN XML or CSV format
 * Extensible for live regulatory feeds.
 * // verify against current rules (e.g. OFAC SDN XML Schema / U.S. Treasury 31 CFR Chapter V)
 */
function ingestOfacSdn(content, format = 'csv') {
  const parsedEntries = [];
  if (format === 'csv') {
    const lines = content.split('\n').filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map(p => p.replace(/^"|"$/g, '').trim());
      if (parts.length >= 4) {
        parsedEntries.push({
          entity_id: `OFAC-${parts[0]}`,
          name: parts[1],
          type: parts[2] || 'Individual',
          program: parts[3] || 'SDN',
          list_name: 'OFAC-SDN',
          remarks: parts[11] || '',
          aliases_list: []
        });
      }
    }
  }
  return parsedEntries;
}

/**
 * Ingest real UN Consolidated List format
 * // verify against current rules (e.g. UN Security Council Consolidated List XML Schema / Resolution 1267/1989/2253)
 */
function ingestUnConsolidated(content, format = 'csv') {
  const parsedEntries = [];
  if (format === 'csv') {
    const lines = content.split('\n').filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map(p => p.replace(/^"|"$/g, '').trim());
      if (parts.length >= 3) {
        parsedEntries.push({
          entity_id: `UN-${parts[0]}`,
          name: `${parts[1] || ''} ${parts[2] || ''}`.trim(),
          type: 'Individual',
          list_name: 'UN-CONSOLIDATED',
          aliases_list: []
        });
      }
    }
  }
  return parsedEntries;
}

/**
 * Synchronize false positive cache
 */
async function syncFalsePositiveCache(force = false) {
  const now = Date.now();
  if (!force && (now - falsePositiveLoadedAt < FP_CACHE_TTL_MS)) {
    return falsePositiveCache;
  }

  try {
    const DecisionModel = models.ScreeningDecision;
    if (DecisionModel && DecisionModel.find) {
      const fpDecisions = await DecisionModel.find({ decision: 'FalsePositive' });
      falsePositiveCache = new Set();
      for (const d of fpDecisions) {
        const key = `${normalizeName(d.screened_name)}|||${d.matched_entity_id}`;
        falsePositiveCache.add(key);
      }
      falsePositiveLoadedAt = now;
    }
  } catch (err) {
    console.warn('[ScreeningService FP Cache Sync Warning]:', err.message);
  }
  return falsePositiveCache;
}

/**
 * Check if a candidate name and matched watchlist entity are marked as False Positive
 */
async function isFalsePositive(screenedName, matchedEntityId) {
  await syncFalsePositiveCache();
  const key = `${normalizeName(screenedName)}|||${matchedEntityId}`;
  return falsePositiveCache.has(key);
}

/**
 * Screen a single name against all active watchlists (with high-speed in-memory memoization)
 */
async function screenName(name, options = {}) {
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return { screened_name: name || '', name: name || '', hits: [], active_hits: [], matched: false, highest_score: 0 };
  }

  const cacheKey = getScreeningCacheKey(name, options);
  if (screeningResultCache.has(cacheKey)) {
    const cached = screeningResultCache.get(cacheKey);
    return { ...cached, screened_name: name, name };
  }

  const watchlists = await loadWatchlists();
  const riskCfg = getRiskConfig();
  const screeningCfg = riskCfg.name_screening || {};

  const threshold = options.threshold != null 
    ? Number(options.threshold) 
    : Number(screeningCfg.match_threshold ?? 80.0);

  const listsToScreen = [];
  if (options.lists) {
    if (options.lists.includes('Sanctions')) listsToScreen.push(...watchlists.sanctions);
    if (options.lists.includes('PEP')) listsToScreen.push(...watchlists.pep);
    if (options.lists.includes('AdverseMedia')) listsToScreen.push(...watchlists.adverse_media);
  } else {
    listsToScreen.push(...watchlists.sanctions, ...watchlists.pep, ...watchlists.adverse_media);
  }

  const hits = [];

  for (const entry of listsToScreen) {
    // 1. Match primary name
    let bestScore = 0;
    let bestMatchType = 'None';
    let matchedNameUsed = entry.name;

    const primarySim = calculateNameSimilarity(name, entry.name);
    if (primarySim.score > bestScore) {
      bestScore = primarySim.score;
      bestMatchType = primarySim.matchType;
      matchedNameUsed = entry.name;
    }

    // 2. Match aliases
    if (entry.aliases_list && entry.aliases_list.length > 0) {
      for (const alias of entry.aliases_list) {
        const aliasSim = calculateNameSimilarity(name, alias);
        if (aliasSim.score > bestScore) {
          bestScore = aliasSim.score;
          bestMatchType = aliasSim.matchType === 'Exact' ? 'Exact' : 'Alias Match';
          matchedNameUsed = alias;
        }
      }
    }

    if (bestScore >= threshold) {
      const isFp = await isFalsePositive(name, entry.entity_id);
      
      let severity = 'Medium';
      if (entry.list_type === 'Sanctions') severity = 'Critical';
      else if (entry.list_type === 'PEP') severity = 'High';
      else if (entry.list_type === 'AdverseMedia') severity = 'Medium';

      let reason = '';
      if (entry.list_type === 'Sanctions') {
        reason = `Sanctions Match: "${name}" matched designated entity "${entry.name}" (${entry.list_name || 'Sanctions List'}, ${bestScore}% match) — Mandatory asset freeze review required.`;
      } else if (entry.list_type === 'PEP') {
        reason = `PEP Match: "${name}" matched Politically Exposed Person "${entry.name}" (${entry.position || 'PEP'}, ${entry.pep_tier || 'Tier 1'}, ${bestScore}% match) — Enhanced Due Diligence required.`;
      } else {
        reason = `Adverse Media Match: "${name}" matched negative news subject "${entry.name}" (${entry.category || 'Financial Crime'}, ${bestScore}% match).`;
      }

      hits.push({
        screened_name: name,
        matched_entity_id: entry.entity_id,
        matched_name: entry.name,
        matched_alias: matchedNameUsed !== entry.name ? matchedNameUsed : null,
        list_type: entry.list_type,
        list_name: entry.list_name || entry.program || entry.category || 'Watchlist',
        match_score: bestScore,
        match_type: bestMatchType,
        severity,
        is_false_positive: isFp,
        status: isFp ? 'FalsePositiveSuppressed' : 'PendingReview',
        reason,
        entry_details: {
          country: entry.country,
          type: entry.type,
          position: entry.position,
          program: entry.program,
          category: entry.category,
          source_url: entry.source_url,
          remarks: entry.remarks || entry.summary
        }
      });
    }
  }

  // Sort descending by match score
  hits.sort((a, b) => b.match_score - a.match_score);

  const activeHits = hits.filter(h => !h.is_false_positive);
  const highestScore = hits.length > 0 ? hits[0].match_score : 0;

  const result = {
    screened_name: name,
    name,
    hits,
    active_hits: activeHits,
    matched: activeHits.length > 0,
    highest_score: highestScore
  };

  if (screeningResultCache.size >= MAX_SCREENING_CACHE) {
    const firstKey = screeningResultCache.keys().next().value;
    screeningResultCache.delete(firstKey);
  }
  screeningResultCache.set(cacheKey, result);

  return result;
}

/**
 * Screen both sender and receiver of a transaction
 */
async function screenTransaction(tx, options = {}) {
  const senderRes = await screenName(tx.sender_name, options);
  const receiverRes = await screenName(tx.receiver_name, options);

  const senderHits = (senderRes.hits || []).map(h => ({ ...h, subject: 'Sender' }));
  const receiverHits = (receiverRes.hits || []).map(h => ({ ...h, subject: 'Receiver' }));

  const allHits = [...senderHits, ...receiverHits];
  const activeHits = allHits.filter(h => !h.is_false_positive);

  const hasSanctions = activeHits.some(h => h.list_type === 'Sanctions');
  const hasPep = activeHits.some(h => h.list_type === 'PEP');
  const hasAdverse = activeHits.some(h => h.list_type === 'AdverseMedia');

  let maxSeverity = 'None';
  if (hasSanctions) maxSeverity = 'Critical';
  else if (hasPep) maxSeverity = 'High';
  else if (hasAdverse) maxSeverity = 'Medium';

  const highestScore = allHits.length > 0 ? Math.max(...allHits.map(h => h.match_score)) : 0;

  return {
    sender_hits: senderHits,
    receiver_hits: receiverHits,
    all_hits: allHits,
    active_hits: activeHits,
    matched: activeHits.length > 0,
    has_sanctions: hasSanctions,
    has_pep: hasPep,
    has_adverse_media: hasAdverse,
    max_severity: maxSeverity,
    highest_score: highestScore,
    reasons: activeHits.map(h => h.reason)
  };
}

/**
 * Screen a batch of transactions with unique name memoization (10x faster for bulk imports)
 */
async function screenTransactionsBatch(transactions, options = {}) {
  const uniqueNames = new Set();
  for (const tx of transactions) {
    if (tx.sender_name && typeof tx.sender_name === 'string' && tx.sender_name.trim().length >= 2) {
      uniqueNames.add(tx.sender_name.trim());
    }
    if (tx.receiver_name && typeof tx.receiver_name === 'string' && tx.receiver_name.trim().length >= 2) {
      uniqueNames.add(tx.receiver_name.trim());
    }
  }

  // Pre-screen all unique names in batch
  const nameMap = new Map();
  for (const name of uniqueNames) {
    const res = await screenName(name, options);
    nameMap.set(name, res);
  }

  return transactions.map(tx => {
    const senderClean = tx.sender_name ? tx.sender_name.trim() : '';
    const receiverClean = tx.receiver_name ? tx.receiver_name.trim() : '';

    const senderRes = nameMap.get(senderClean) || { hits: [], active_hits: [] };
    const receiverRes = nameMap.get(receiverClean) || { hits: [], active_hits: [] };

    const senderHits = (senderRes.hits || []).map(h => ({ ...h, subject: 'Sender' }));
    const receiverHits = (receiverRes.hits || []).map(h => ({ ...h, subject: 'Receiver' }));

    const allHits = [...senderHits, ...receiverHits];
    const activeHits = allHits.filter(h => !h.is_false_positive);

    const hasSanctions = activeHits.some(h => h.list_type === 'Sanctions');
    const hasPep = activeHits.some(h => h.list_type === 'PEP');
    const hasAdverse = activeHits.some(h => h.list_type === 'AdverseMedia');

    let maxSeverity = 'None';
    if (hasSanctions) maxSeverity = 'Critical';
    else if (hasPep) maxSeverity = 'High';
    else if (hasAdverse) maxSeverity = 'Medium';

    const highestScore = allHits.length > 0 ? Math.max(...allHits.map(h => h.match_score)) : 0;

    return {
      sender_hits: senderHits,
      receiver_hits: receiverHits,
      all_hits: allHits,
      active_hits: activeHits,
      matched: activeHits.length > 0,
      has_sanctions: hasSanctions,
      has_pep: hasPep,
      has_adverse_media: hasAdverse,
      max_severity: maxSeverity,
      highest_score: highestScore,
      reasons: activeHits.map(h => h.reason)
    };
  });
}

/**
 * Record a True Match or False Positive compliance decision
 */
async function recordDecision(decisionData) {
  const {
    entity_type = 'Transaction',
    entity_id = '',
    screened_name,
    matched_entity_id,
    matched_name,
    list_type = 'Sanctions',
    match_score = 0,
    decision = 'FalsePositive',
    notes = '',
    decided_by = 'Compliance Officer'
  } = decisionData;

  if (!screened_name || !matched_entity_id) {
    throw new Error('screened_name and matched_entity_id are required.');
  }

  const DecisionModel = models.ScreeningDecision;
  const { generateDecisionId } = require('../utils/idGenerator');
  const decisionId = generateDecisionId();

  let record;
  if (DecisionModel && DecisionModel.create) {
    record = await DecisionModel.create({
      decision_id: decisionId,
      entity_type,
      entity_id,
      screened_name,
      matched_entity_id,
      matched_name: matched_name || screened_name,
      list_type,
      match_score: Number(match_score),
      decision,
      notes,
      decided_by,
      decided_at: new Date().toISOString()
    });
  }

  // Refresh FP Cache and clear screening memoization
  screeningResultCache.clear();
  await syncFalsePositiveCache(true);

  // Audit Log
  await logAction(
    decided_by,
    'Compliance',
    'SCREENING_DECISION',
    '127.0.0.1',
    `Marked screening match "${screened_name}" -> ${matched_entity_id} (${list_type}) as ${decision}. Notes: ${notes || 'None'}`
  );

  return record || { decision_id: decisionId, ...decisionData };
}

module.exports = {
  normalizeName,
  tokenizeName,
  calculateNameSimilarity,
  calculateInitialsScore,
  loadWatchlists,
  ingestOfacSdn,
  ingestUnConsolidated,
  isFalsePositive,
  screenName,
  screenTransaction,
  screenTransactionsBatch,
  recordDecision,
  syncFalsePositiveCache
};
