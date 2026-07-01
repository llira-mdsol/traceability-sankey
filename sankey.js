/**
 * Sankey Diagram Rendering Engine
 * Uses Plotly.js to render the traceability Sankey diagram.
 */

/**
 * Convert our data model into Plotly Sankey format.
 * Plotly expects numeric indices for source/target, not string IDs.
 */
function buildSankeyData(traceData) {
    const nodeMap = new Map();
    traceData.nodes.forEach((node, idx) => {
        nodeMap.set(node.id, idx);
    });

    const labels = traceData.nodes.map(n => n.label);
    const nodeColors = traceData.nodes.map(n => LAYER_COLORS[n.layer]);

    const customdata = traceData.nodes.map(n => ({
        type: n.type,
        source: n.source,
        id: n.id
    }));

    const sourceIndices = [];
    const targetIndices = [];
    const values = [];
    const linkColors = [];

    traceData.links.forEach(link => {
        const srcIdx = nodeMap.get(link.source);
        const tgtIdx = nodeMap.get(link.target);
        if (srcIdx !== undefined && tgtIdx !== undefined) {
            sourceIndices.push(srcIdx);
            targetIndices.push(tgtIdx);
            values.push(link.value);
            // Color link by source node's layer
            const srcNode = traceData.nodes[srcIdx];
            linkColors.push(LINK_COLORS[srcNode.layer]);
        }
    });

    return {
        type: 'sankey',
        orientation: 'h',
        arrangement: 'snap',
        node: {
            pad: 20,
            thickness: 25,
            line: { color: 'rgba(255,255,255,0.3)', width: 0.5 },
            label: labels,
            color: nodeColors,
            customdata: customdata,
            hovertemplate: '<b>%{label}</b><br>Type: %{customdata.type}<br>Source: %{customdata.source}<br>ID: %{customdata.id}<extra></extra>'
        },
        link: {
            source: sourceIndices,
            target: targetIndices,
            value: values,
            color: linkColors,
            hovertemplate: '%{source.label}<br>→ %{target.label}<br>Weight: %{value}<extra></extra>'
        }
    };
}

/**
 * Render the Sankey diagram in the target element.
 */
function renderSankey(traceData, mdsoRef) {
    const sankeyData = buildSankeyData(traceData);

    const layout = {
        title: {
            text: `Traceability: ${mdsoRef}`,
            font: { size: 16, color: '#4fc3f7' },
            x: 0.01
        },
        font: { size: 11, color: '#b0bec5', family: '-apple-system, BlinkMacSystemFont, sans-serif' },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 10, r: 10, t: 50, b: 30 },
        // Annotations for layer headers
        annotations: [
            { x: 0.0, y: 1.08, text: '<b>Objectives</b>', showarrow: false, font: { color: '#e57373', size: 12 }, xref: 'paper', yref: 'paper' },
            { x: 0.2, y: 1.08, text: '<b>Initiatives</b>', showarrow: false, font: { color: '#ffb74d', size: 12 }, xref: 'paper', yref: 'paper' },
            { x: 0.4, y: 1.08, text: '<b>MDSO Projects</b>', showarrow: false, font: { color: '#fff176', size: 12 }, xref: 'paper', yref: 'paper' },
            { x: 0.6, y: 1.08, text: '<b>Epics / Features</b>', showarrow: false, font: { color: '#81c784', size: 12 }, xref: 'paper', yref: 'paper' },
            { x: 0.8, y: 1.08, text: '<b>Stories</b>', showarrow: false, font: { color: '#4fc3f7', size: 12 }, xref: 'paper', yref: 'paper' },
            { x: 1.0, y: 1.08, text: '<b>PRs</b>', showarrow: false, font: { color: '#ce93d8', size: 12 }, xref: 'paper', yref: 'paper' },
        ]
    };

    const config = {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        displaylogo: false
    };

    Plotly.newPlot('sankey-chart', [sankeyData], layout, config);
}

/**
 * Main entry point — called when user clicks "Load Traceability"
 */
async function loadDiagram() {
    const input = document.getElementById('mdso-ref');
    const mdsoRef = input.value.trim().toUpperCase();

    if (!mdsoRef) {
        updateStatus('⚠️ Please enter an MDSO project reference', 'error');
        return;
    }

    showLoading(true);
    updateStatus(`Loading traceability for ${mdsoRef}...`, 'loading');

    try {
        const data = await fetchTraceabilityData(mdsoRef);

        if (!data) {
            showLoading(false);
            updateStatus(`❌ No data found for ${mdsoRef}. Try MDSO-1001 or MDSO-2002 (sample data).`, 'error');
            return;
        }

        renderSankey(data, mdsoRef);

        const nodeCount = data.nodes.length;
        const linkCount = data.links.length;
        const prCount = data.nodes.filter(n => n.type === 'PR').length;
        const storyCount = data.nodes.filter(n => n.type === 'Story').length;

        showLoading(false);
        updateStatus(
            `✅ ${mdsoRef} — ${nodeCount} nodes, ${linkCount} links | ${prCount} PRs → ${storyCount} Stories`,
            'success'
        );
    } catch (err) {
        showLoading(false);
        updateStatus(`❌ Error: ${err.message}`, 'error');
        console.error('Traceability load error:', err);
    }
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function updateStatus(message, type) {
    const el = document.getElementById('status-text');
    el.textContent = message;
    el.style.color = type === 'error' ? '#ef5350' : type === 'success' ? '#66bb6a' : '#78909c';
}

// Auto-load on page ready
document.addEventListener('DOMContentLoaded', () => {
    loadDiagram();
});

// Allow Enter key to trigger load
document.getElementById('mdso-ref').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadDiagram();
});
