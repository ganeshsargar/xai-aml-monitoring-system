import React, { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';

const GraphView = ({ elements, onNodeClick }) => {
  const containerRef = useRef(null);
  const cyRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !elements || elements.length === 0) return;

    // Destroy existing instance if present
    if (cyRef.current) {
      cyRef.current.destroy();
    }

    // Initialize Cytoscape
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: elements,
      boxSelectionEnabled: false,
      autounselectify: true,
      
      layout: {
        name: 'cose', // Physics-based layout for money flow clustering
        idealEdgeLength: 100,
        nodeOverlap: 20,
        refresh: 20,
        fit: true,
        padding: 30,
        randomize: false,
        componentSpacing: 100,
        nodeRepulsion: 400000,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0
      },

      style: [
        // Node Styles
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'font-family': 'Outfit, sans-serif',
            'font-size': '10px',
            'text-valign': 'bottom',
            'text-margin-y': '6px',
            'color': (ele) => document.documentElement.classList.contains('dark') ? '#cbd5e1' : '#475569',
            'background-color': '#94a3b8',
            // Scale node size based on PageRank centrality
            'width': 'mapData(pagerank, 0, 1, 20, 70)',
            'height': 'mapData(pagerank, 0, 1, 20, 70)',
            'border-width': '2px',
            'border-color': '#e2e8f0',
            'transition-property': 'background-color, border-color, border-width',
            'transition-duration': '0.3s'
          }
        },
        
        // Node Risk Levels
        {
          selector: 'node[risk_level="Low"]',
          style: {
            'background-color': '#10b981', // Emerald
            'border-color': '#a7f3d0'
          }
        },
        {
          selector: 'node[risk_level="Medium"]',
          style: {
            'background-color': '#f59e0b', // Amber
            'border-color': '#fde68a'
          }
        },
        {
          selector: 'node[risk_level="High"]',
          style: {
            'background-color': '#f97316', // Orange
            'border-color': '#ffedd5'
          }
        },
        {
          selector: 'node[risk_level="Critical"]',
          style: {
            'background-color': '#ef4444', // Red
            'border-color': '#fee2e2'
          }
        },

        // Edge Styles
        {
          selector: 'edge',
          style: {
            'width': 'mapData(amount, 100, 100000, 2, 8)', // Thicker edges for larger amounts
            'line-color': '#cbd5e1',
            'target-arrow-color': '#cbd5e1',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 1.2,
            'opacity': 0.7,
            'label': (ele) => `₹${parseFloat(ele.data('amount') || 0).toLocaleString()}`,
            'font-size': '8px',
            'color': '#94a3b8',
            'text-rotation': 'autorotate',
            'text-margin-y': '-10px',
            'font-family': 'Inter, sans-serif'
          }
        },
        
        // Suspicious Edge highlights
        {
          selector: 'edge[is_laundering=1]',
          style: {
            'line-color': '#f43f5e',
            'target-arrow-color': '#f43f5e',
            'opacity': 0.95
          }
        },

        // Round-Tripping (Cycle) Edge Highlights
        {
          selector: 'edge[is_cycle=1]',
          style: {
            'line-color': '#f97316',
            'target-arrow-color': '#f97316',
            'width': 6,
            'line-style': 'dashed',
            'line-dash-pattern': [6, 3],
            'opacity': 1.0,
            'label': (ele) => `₹${parseFloat(ele.data('amount') || 0).toLocaleString()} (Round-Trip)`,
            'color': '#f97316',
            'font-size': '9px',
            'font-weight': 'bold'
          }
        },

        // Selected highlights
        {
          selector: 'node:selected',
          style: {
            'border-width': '4px',
            'border-color': '#3b82f6',
            'background-color': '#2563eb'
          }
        }
      ]
    });

    // Set Node Click Listener
    cyRef.current.on('tap', 'node', (evt) => {
      const node = evt.target;
      if (onNodeClick) {
        onNodeClick(node.data());
      }
    });

    // Fit layout on window resize
    const handleResize = () => {
      if (cyRef.current) {
        cyRef.current.resize();
        cyRef.current.fit();
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (cyRef.current) {
        cyRef.current.destroy();
      }
    };
  }, [elements, onNodeClick]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden bg-gray-50 dark:bg-darkBg/50 border border-gray-100 dark:border-darkBorder">
      <div 
        ref={containerRef} 
        className="w-full h-full cytoscape-container min-h-[450px]"
      />
      <div className="absolute bottom-4 left-4 p-3 flex flex-wrap gap-4 text-xs font-semibold bg-white/95 dark:bg-darkPanel/95 backdrop-blur shadow-sm rounded-xl border border-gray-100 dark:border-darkBorder">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span>Low Risk</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span>Medium Risk</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
          <span>High Risk</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
          <span>Critical Alert Node</span>
        </div>
      </div>
    </div>
  );
};

export default GraphView;
