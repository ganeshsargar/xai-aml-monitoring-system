import React from 'react';

const ShapChart = ({ shapData }) => {
  if (!shapData || shapData.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-gray-400">
        No SHAP attribution data available.
      </div>
    );
  }

  // Map backend feature names to readable labels
  const labelMap = {
    'amount': 'Transaction Amount (₹)',
    'is_high_risk_country': 'High Risk Jurisdiction Transfer',
    'is_wire_or_crypto': 'Wire/Crypto channel used',
    'is_night': 'Midnight / Night Transfer',
    'is_transfer': 'Category is Transfer',
    'amount_near_threshold': 'Structuring: Near ₹10K limit',
    'is_large_amount': 'High Volume Transfer',
    'sender_time_diff': 'Sender Speed: Time spacing',
    'receiver_time_diff': 'Receiver Speed: Time spacing',
    'sender_velocity_2h': 'Sender Velocity (2 Hour Window)',
    'receiver_velocity_2h': 'Receiver Velocity (2 Hour Window)'
  };

  // Find maximum absolute value to normalize the bars
  const maxVal = Math.max(...shapData.map(d => Math.abs(d.shap_value || 0.01)), 0.1);

  // Sort by highest positive impact (most suspicious reasons first)
  const sortedData = [...shapData].sort((a, b) => (b.shap_value || 0) - (a.shap_value || 0));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center text-xs font-semibold text-gray-400 border-b border-gray-100 dark:border-darkBorder pb-2">
        <span>Risk Indicators (SHAP Features)</span>
        <div className="flex gap-4">
          <span className="text-emerald-500">Safe (- Impact)</span>
          <span className="text-rose-500">Risk (+ Impact)</span>
        </div>
      </div>

      <div className="space-y-3">
        {sortedData.map((item, idx) => {
          const readableName = labelMap[item.feature] || item.feature;
          const shapVal = item.shap_value || 0;
          const actualVal = item.actual_value;
          
          // Calculate percentage width of the bar (cap at 100%)
          const widthPercent = Math.min((Math.abs(shapVal) / maxVal) * 100, 100);
          const isPositive = shapVal > 0;

          // Format actual values for display
          let displayValue = actualVal;
          if (item.feature === 'amount') {
            displayValue = `₹${parseFloat(actualVal).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
          } else if (item.feature.startsWith('is_') || item.feature.endsWith('_threshold')) {
            displayValue = actualVal === 1 ? 'Yes' : 'No';
          } else if (item.feature.endsWith('_time_diff')) {
            displayValue = actualVal === 9999.0 ? 'None' : `${Math.round(actualVal)} min`;
          }

          return (
            <div key={idx} className="grid grid-cols-12 items-center gap-3 text-xs">
              {/* Label */}
              <div className="col-span-4 font-medium text-gray-600 dark:text-gray-300 truncate" title={readableName}>
                {readableName}
              </div>

              {/* Bar visualization */}
              <div className="col-span-6 relative h-5 flex items-center bg-gray-100 dark:bg-darkBg/60 rounded-md overflow-hidden">
                {/* Midline divider */}
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gray-300 dark:bg-gray-700 z-10" />

                {isPositive ? (
                  // Positive contribution: goes to the right (red)
                  <div 
                    style={{ 
                      left: '50%', 
                      width: `${widthPercent / 2}%` 
                    }}
                    className="absolute h-full bg-gradient-to-r from-rose-400 to-rose-600 dark:from-rose-500 dark:to-rose-700 rounded-r-md transition-all duration-500"
                  />
                ) : (
                  // Negative contribution: goes to the left (green)
                  <div 
                    style={{ 
                      right: '50%', 
                      width: `${widthPercent / 2}%` 
                    }}
                    className="absolute h-full bg-gradient-to-l from-emerald-400 to-emerald-600 dark:from-emerald-500 dark:to-emerald-700 rounded-l-md transition-all duration-500"
                  />
                )}
              </div>

              {/* Value indicator */}
              <div className="col-span-2 text-right font-mono font-semibold text-gray-700 dark:text-gray-400">
                {displayValue}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-gray-400 dark:text-gray-500 italic mt-2 text-center">
        * SHAP values measure the additive feature attribution compared to the baseline risk probability.
      </div>
    </div>
  );
};

export default ShapChart;
