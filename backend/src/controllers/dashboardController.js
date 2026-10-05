const { getDashboardAnalytics, exportDatasetCSV } = require('../services/dashboardService');

/**
 * GET /api/dashboard/kpis
 * Returns comprehensive operational KPIs, feedback metrics, typology breakdowns, and entity risk tables.
 */
const getDashboardKPIs = async (req, res) => {
  try {
    const {
      timeRange,
      startDate,
      endDate,
      country,
      payment_method,
      risk_level,
      refresh
    } = req.query;

    const filters = {
      timeRange: timeRange || '30d',
      startDate,
      endDate,
      country,
      payment_method,
      risk_level
    };

    const forceRefresh = refresh === 'true' || refresh === '1';
    const analytics = await getDashboardAnalytics(filters, forceRefresh);

    return res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('[Dashboard Controller Error]:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/dashboard/export-csv
 * Exports any specific dashboard chart dataset as CSV.
 */
const exportDashboardCSV = async (req, res) => {
  try {
    const { dataset_key = 'alert_volume_trend', timeRange, startDate, endDate, country } = req.query;
    const filters = { timeRange, startDate, endDate, country };

    const analytics = await getDashboardAnalytics(filters, false);

    let targetData = [];
    switch (dataset_key) {
      case 'alert_volume_trend':
        targetData = analytics.operational_kpis.alert_volume_trend;
        break;
      case 'analyst_workload':
        targetData = analytics.operational_kpis.analyst_workload;
        break;
      case 'detection_mode_split':
        targetData = analytics.feedback_attribution_kpis.detection_mode_split;
        break;
      case 'monthly_feedback_trend':
        targetData = analytics.feedback_attribution_kpis.monthly_feedback_trend;
        break;
      case 'typology_breakdown':
        targetData = analytics.typology_breakdown;
        break;
      case 'top_risky_customers':
        targetData = analytics.risk_entities.top_risky_customers;
        break;
      case 'top_risky_accounts':
        targetData = analytics.risk_entities.top_risky_accounts;
        break;
      case 'geographic_risk_map':
        targetData = analytics.risk_entities.geographic_risk_map;
        break;
      case 'channel_risk_heatmap':
        targetData = analytics.risk_entities.channel_risk_heatmap;
        break;
      default:
        targetData = analytics.operational_kpis.alert_volume_trend;
    }

    const csvContent = exportDatasetCSV(dataset_key, targetData);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="fundtrace_${dataset_key}_${Date.now()}.csv"`);
    return res.send(csvContent);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getDashboardKPIs,
  exportDashboardCSV
};
