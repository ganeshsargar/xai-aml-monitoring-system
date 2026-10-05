/**
 * Screening Controller
 * Endpoints for watchlist search, ad-hoc name screening, and true/false-positive decisioning.
 */

const {
  screenName,
  screenTransaction,
  recordDecision,
  loadWatchlists
} = require('../services/screeningService');
const { models } = require('../config/db');

/**
 * POST /api/screening/screen
 * Ad-hoc name screening against Sanctions, PEP, and Adverse Media watchlists.
 */
exports.screenName = async (req, res) => {
  try {
    const { name, threshold, lists } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'Name parameter is required.' });
    }

    const result = await screenName(name, { threshold, lists });
    return res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[ScreeningController Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/screening/decisions
 * Retrieve compliance screening decision records.
 */
exports.getDecisions = async (req, res) => {
  try {
    const { entity_id, screened_name, decision } = req.query;
    const filter = {};
    if (entity_id) filter.entity_id = entity_id;
    if (screened_name) filter.screened_name = screened_name;
    if (decision) filter.decision = decision;

    const DecisionModel = models.ScreeningDecision;
    let decisions = [];
    if (DecisionModel && DecisionModel.find) {
      decisions = await DecisionModel.find(filter);
    }

    return res.json({
      success: true,
      data: decisions
    });
  } catch (err) {
    console.error('[ScreeningController Decisions Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/screening/decisions
 * Record True Match or False Positive decision with audit trail.
 */
exports.recordDecision = async (req, res) => {
  try {
    const {
      entity_type,
      entity_id,
      screened_name,
      matched_entity_id,
      matched_name,
      list_type,
      match_score,
      decision,
      notes
    } = req.body;

    if (!screened_name || !matched_entity_id || !decision) {
      return res.status(400).json({
        success: false,
        error: 'screened_name, matched_entity_id, and decision are required.'
      });
    }

    const username = req.user ? req.user.username : (req.body.decided_by || 'Compliance Officer');

    const record = await recordDecision({
      entity_type,
      entity_id,
      screened_name,
      matched_entity_id,
      matched_name,
      list_type,
      match_score,
      decision,
      notes,
      decided_by: username
    });

    return res.status(201).json({
      success: true,
      message: `Screening match successfully classified as ${decision}.`,
      data: record
    });
  } catch (err) {
    console.error('[ScreeningController Record Decision Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/screening/watchlists
 * Overview of loaded watchlists and sample entries.
 */
exports.getWatchlists = async (req, res) => {
  try {
    const watchlists = await loadWatchlists();
    return res.json({
      success: true,
      data: {
        sanctions_count: watchlists.sanctions.length,
        pep_count: watchlists.pep.length,
        adverse_media_count: watchlists.adverse_media.length,
        loaded_at: watchlists.loadedAt,
        sample_entries: {
          sanctions: watchlists.sanctions.slice(0, 3),
          pep: watchlists.pep.slice(0, 3),
          adverse_media: watchlists.adverse_media.slice(0, 3)
        }
      }
    });
  } catch (err) {
    console.error('[ScreeningController Watchlists Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
