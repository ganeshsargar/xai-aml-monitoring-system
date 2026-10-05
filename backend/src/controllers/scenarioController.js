const { models } = require('../config/db');
const {
  BUILTIN_SCENARIOS,
  refreshScenarios,
  runBacktest
} = require('../services/scenarioEngine');

/**
 * GET /api/scenarios
 * Returns all compliance detection scenarios.
 */
exports.getScenarios = async (req, res) => {
  try {
    let scenarios = [];
    if (models.Scenario && models.Scenario.find) {
      scenarios = await models.Scenario.find({});
    }

    if (!scenarios || scenarios.length === 0) {
      scenarios = BUILTIN_SCENARIOS;
    }

    // Sort: Critical, High, Medium, Low
    const sevRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    scenarios.sort((a, b) => (sevRank[a.severity] ?? 4) - (sevRank[b.severity] ?? 4));

    return res.json({
      success: true,
      data: scenarios,
      count: scenarios.length
    });
  } catch (err) {
    console.error('[ScenarioController Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/scenarios/:id
 * Returns scenario details by ID.
 */
exports.getScenarioById = async (req, res) => {
  try {
    const id = req.params.id;
    let scenario = null;

    if (models.Scenario && models.Scenario.findOne) {
      scenario = await models.Scenario.findOne({ scenario_id: id });
      if (!scenario) {
        scenario = await models.Scenario.findById(id);
      }
    }

    if (!scenario) {
      scenario = BUILTIN_SCENARIOS.find(s => s.scenario_id === id);
    }

    if (!scenario) {
      return res.status(404).json({ success: false, error: `Scenario not found: ${id}` });
    }

    return res.json({
      success: true,
      data: scenario
    });
  } catch (err) {
    console.error('[ScenarioController Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/scenarios
 * Creates a new custom compliance scenario.
 */
exports.createScenario = async (req, res) => {
  try {
    const { scenario_id, name, description, category, severity, weight, parameters, explanation_template } = req.body;

    if (!scenario_id || !name) {
      return res.status(400).json({ success: false, error: 'scenario_id and name are required.' });
    }

    const existing = await models.Scenario.findOne({ scenario_id });
    if (existing) {
      return res.status(400).json({ success: false, error: `Scenario ID "${scenario_id}" already exists.` });
    }

    const newScenario = await models.Scenario.create({
      scenario_id,
      name,
      description: description || '',
      category: category || 'Custom',
      severity: severity || 'Medium',
      weight: Number(weight || 25),
      enabled: req.body.enabled !== false,
      parameters: parameters || {},
      explanation_template: explanation_template || 'Scenario {scenario_id} triggered on account {account_id}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    refreshScenarios();

    return res.status(201).json({
      success: true,
      message: 'Compliance scenario created successfully.',
      data: newScenario
    });
  } catch (err) {
    console.error('[ScenarioController Create Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * PUT /api/scenarios/:id
 * Updates scenario parameters, severity, explanation, or enabled status.
 */
exports.updateScenario = async (req, res) => {
  try {
    const id = req.params.id;
    let scenario = await models.Scenario.findOne({ scenario_id: id });
    if (!scenario) {
      scenario = await models.Scenario.findById(id);
    }

    if (!scenario) {
      // If updating a built-in scenario that has not yet been cloned into DB, insert it now
      const builtin = BUILTIN_SCENARIOS.find(s => s.scenario_id === id);
      if (builtin) {
        scenario = await models.Scenario.create({
          ...builtin,
          ...req.body,
          scenario_id: id,
          updatedAt: new Date().toISOString()
        });
        refreshScenarios();
        return res.json({
          success: true,
          message: 'Scenario initialized and updated successfully.',
          data: scenario
        });
      }
      return res.status(404).json({ success: false, error: `Scenario not found: ${id}` });
    }

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.severity !== undefined) updates.severity = req.body.severity;
    if (req.body.weight !== undefined) updates.weight = Number(req.body.weight);
    if (req.body.enabled !== undefined) updates.enabled = Boolean(req.body.enabled);
    if (req.body.parameters !== undefined) updates.parameters = req.body.parameters;
    if (req.body.explanation_template !== undefined) updates.explanation_template = req.body.explanation_template;
    updates.updatedAt = new Date().toISOString();

    if (models.Scenario.updateOne) {
      await models.Scenario.updateOne({ scenario_id: id }, { $set: updates });
    } else {
      Object.assign(scenario, updates);
      if (scenario.save) await scenario.save();
    }

    refreshScenarios();
    const updated = await models.Scenario.findOne({ scenario_id: id });

    return res.json({
      success: true,
      message: 'Compliance scenario updated successfully.',
      data: updated || scenario
    });
  } catch (err) {
    console.error('[ScenarioController Update Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * DELETE /api/scenarios/:id
 * Deletes custom scenario or disables core scenario.
 */
exports.deleteScenario = async (req, res) => {
  try {
    const id = req.params.id;
    const isBuiltin = BUILTIN_SCENARIOS.some(s => s.scenario_id === id);

    if (isBuiltin) {
      // Built-in scenarios cannot be permanently deleted; disable them instead
      await models.Scenario.updateOne({ scenario_id: id }, { $set: { enabled: false, updatedAt: new Date().toISOString() } });
      refreshScenarios();
      return res.json({
        success: true,
        message: 'Built-in scenario disabled successfully (cannot be deleted).'
      });
    }

    if (models.Scenario.deleteOne) {
      await models.Scenario.deleteOne({ scenario_id: id });
    }
    refreshScenarios();

    return res.json({
      success: true,
      message: 'Custom scenario deleted successfully.'
    });
  } catch (err) {
    console.error('[ScenarioController Delete Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/scenarios/:id/backtest
 * Runs candidate parameter tuning against historical transactions.
 */
exports.backtestScenario = async (req, res) => {
  try {
    const id = req.params.id;
    const candidateParams = req.body.parameters || {};
    const options = {
      limit: req.body.limit,
      date_range: req.body.date_range
    };

    // Verify scenario exists
    let scenario = await models.Scenario.findOne({ scenario_id: id });
    if (!scenario) {
      scenario = BUILTIN_SCENARIOS.find(s => s.scenario_id === id);
    }
    if (!scenario) {
      return res.status(404).json({ success: false, error: `Scenario not found: ${id}` });
    }

    // Merge baseline parameters with candidate overrides
    const effectiveParams = {
      ...(scenario.parameters || {}),
      ...candidateParams
    };

    const backtestResult = await runBacktest(id, effectiveParams, options);

    return res.json({
      success: true,
      scenario_id: id,
      scenario_name: scenario.name,
      data: backtestResult
    });
  } catch (err) {
    console.error('[Scenario Backtest Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
