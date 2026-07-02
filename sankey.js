/**
 * Sankey Diagram Rendering Engine — D3 + d3-sankey
 * Supports pan, zoom, drag nodes, tooltips, and 8 layers.
 */

let currentZoomTransform = d3.zoomIdentity;
let zoomBehavior = null;
let svgElement = null;

/**
 * Build the legend dynamically from LAYER_NAMES and LAYER_COLORS
 */
function buildLegend() {
    const legend = document.getElementById('legend');
    legend.innerHTML = '';
    for (const [layer, name] of Object.entries(LAYER_NAMES)) {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `<div class="legend-dot" style="background:${LAYER_COLORS[layer]}"></div>${name}`;
        legend.appendChild(item);
    }
}

/**
 * Render the Sankey diagram using D3.
 */
function renderSankey(traceData, mdsoRef) {
    // Verify d3-sankey loaded
    if (typeof d3.sankey !== 'function') {
        updateStatus('❌ d3-sankey library not loaded. Check network tab.', 'error');
        console.error('d3.sankey is', typeof d3.sankey);
        return;
    }

    const container = document.getElementById('chart-container');
    const svg = d3.select('#sankey-chart');
    svg.selectAll('*').remove();

    const width = container.clientWidth || 1200;
    const height = container.clientHeight || 700;

    console.log('[Sankey] Container dimensions:', width, 'x', height);
    console.log('[Sankey] Input data:', traceData.nodes.length, 'nodes,', traceData.links.length, 'links');

    svg.attr('width', width).attr('height', height);
    svgElement = svg;

    const margin = { top: 40, right: 30, bottom: 20, left: 30 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Build node index map (for validation)
    const nodeIdSet = new Set(traceData.nodes.map(n => n.id));

    // Build d3-sankey compatible data — use string IDs for source/target
    const sankeyNodes = traceData.nodes.map(n => ({
        ...n,
        name: n.label
    }));

    // Build layer lookup for link filtering
    const nodeLayerMap = new Map(traceData.nodes.map(n => [n.id, n.layer]));

    const sankeyLinks = traceData.links
        .filter(l => {
            if (!nodeIdSet.has(l.source) || !nodeIdSet.has(l.target)) return false;
            if (l.source === l.target) return false;
            // d3-sankey requires links to flow forward (source layer < target layer)
            const srcLayer = nodeLayerMap.get(l.source);
            const tgtLayer = nodeLayerMap.get(l.target);
            return srcLayer < tgtLayer;
        })
        .map(l => ({
            source: l.source,
            target: l.target,
            value: Math.max(1, l.value || 1)
        }));

    // Remove orphan nodes (no links after filtering)
    const connectedIds = new Set();
    sankeyLinks.forEach(l => {
        connectedIds.add(l.source);
        connectedIds.add(l.target);
    });
    const filteredNodes = sankeyNodes.filter(n => connectedIds.has(n.id));

    if (filteredNodes.length === 0 || sankeyLinks.length === 0) {
        updateStatus(`⚠️ No valid forward-flowing links found. Nodes: ${sankeyNodes.length}, Filtered links: ${sankeyLinks.length}`, 'error');
        console.warn('All links filtered. This may mean links go between same-layer or backward nodes.');
        console.log('Layer distribution:', Object.entries(
            traceData.nodes.reduce((acc, n) => { acc[n.layer] = (acc[n.layer] || 0) + 1; return acc; }, {})
        ));
        return;
    }

    // Remap layers to be contiguous (d3-sankey crashes on gaps in layer indices)
    const presentLayers = [...new Set(filteredNodes.map(n => n.layer))].sort((a, b) => a - b);
    const layerRemap = new Map(presentLayers.map((layer, idx) => [layer, idx]));
    filteredNodes.forEach(n => {
        n.originalLayer = n.layer;
        n.layer = layerRemap.get(n.layer);
    });

    console.log('[Sankey] Rendering:', filteredNodes.length, 'nodes,', sankeyLinks.length, 'links');
    console.log('[Sankey] Layer dist:', filteredNodes.reduce((acc, n) => { acc[n.layer] = (acc[n.layer] || 0) + 1; return acc; }, {}));
    console.log('[Sankey] Layer remap:', Object.fromEntries(layerRemap));

    // Configure sankey layout
    const numLayers = Object.keys(LAYERS).length;
    // Adapt padding based on dataset size
    const maxNodesInLayer = Math.max(...Object.values(
        filteredNodes.reduce((acc, n) => { acc[n.layer] = (acc[n.layer] || 0) + 1; return acc; }, {})
    ));
    const adaptivePadding = maxNodesInLayer > 50 ? 2 : maxNodesInLayer > 20 ? 6 : 14;
    // For large datasets, expand the virtual height
    const virtualHeight = Math.max(innerHeight, maxNodesInLayer * (adaptivePadding + 4));

    console.log('[Sankey] Max nodes in layer:', maxNodesInLayer, '| Padding:', adaptivePadding, '| Virtual height:', virtualHeight);

    const sankey = d3.sankey()
        .nodeId(d => d.id)
        .nodeWidth(18)
        .nodePadding(adaptivePadding)
        .nodeSort(null)
        .nodeAlign((node, n) => {
            // Force nodes into their layer column, scaled to total columns
            const layer = node.layer !== undefined ? node.layer : 4;
            return layer;
        })
        .extent([[0, 0], [innerWidth, virtualHeight]]);

    // Compute layout
    let graph;
    try {
        graph = sankey({
            nodes: filteredNodes.map(d => ({ ...d })),
            links: sankeyLinks.map(d => ({ ...d }))
        });
    } catch (err) {
        console.error('Sankey layout error:', err);
        console.log('Nodes:', filteredNodes.length, 'Links:', sankeyLinks.length);
        // Log orphan links for debugging
        const ids = new Set(filteredNodes.map(n => n.id));
        const badLinks = sankeyLinks.filter(l => !ids.has(l.source) || !ids.has(l.target));
        if (badLinks.length) {
            console.warn('Links referencing missing nodes:', badLinks.slice(0, 10));
        }
        updateStatus(`❌ Layout error: ${err.message}. Check console for details.`, 'error');
        return;
    }

    // Create zoom group
    const zoomGroup = svg.append('g').attr('class', 'zoom-group');

    // Apply zoom behavior
    zoomBehavior = d3.zoom()
        .scaleExtent([0.3, 5])
        .on('zoom', (event) => {
            currentZoomTransform = event.transform;
            zoomGroup.attr('transform', event.transform);
            updateZoomInfo(event.transform.k);
        });

    svg.call(zoomBehavior);

    // Offset group for margins
    const g = zoomGroup.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Layer headers
    const layerPositions = {};
    graph.nodes.forEach(node => {
        const layer = node.originalLayer !== undefined ? node.originalLayer : node.layer;
        if (!layerPositions[layer]) {
            layerPositions[layer] = { minX: Infinity, maxX: -Infinity };
        }
        layerPositions[layer].minX = Math.min(layerPositions[layer].minX, node.x0);
        layerPositions[layer].maxX = Math.max(layerPositions[layer].maxX, node.x1);
    });

    for (const [layer, pos] of Object.entries(layerPositions)) {
        const centerX = (pos.minX + pos.maxX) / 2;
        g.append('text')
            .attr('class', 'layer-header')
            .attr('x', centerX)
            .attr('y', -15)
            .attr('fill', LAYER_COLORS[layer] || '#546e7a')
            .text(LAYER_NAMES[layer] || `Layer ${layer}`);
    }

    // Draw links
    const link = g.append('g')
        .attr('fill', 'none')
        .attr('stroke-opacity', 0.35)
        .selectAll('path')
        .data(graph.links)
        .join('path')
        .attr('d', d3.sankeyLinkHorizontal())
        .attr('stroke', d => LAYER_COLORS[d.source.originalLayer !== undefined ? d.source.originalLayer : d.source.layer])
        .attr('stroke-width', d => Math.max(2, d.width))
        .style('mix-blend-mode', 'screen')
        .on('mouseover', function(event, d) {
            d3.select(this).attr('stroke-opacity', 0.7);
            showTooltip(event, `
                <div class="tt-title">${d.source.label} → ${d.target.label}</div>
                <div class="tt-row">Weight: ${d.value}</div>
            `);
        })
        .on('mousemove', (event) => moveTooltip(event))
        .on('mouseout', function() {
            d3.select(this).attr('stroke-opacity', 0.35);
            hideTooltip();
        });

    // Draw nodes
    const node = g.append('g')
        .selectAll('g')
        .data(graph.nodes)
        .join('g')
        .attr('transform', d => `translate(${d.x0},${d.y0})`)
        .call(d3.drag()
            .on('start', function() { this.parentNode.appendChild(this); })
            .on('drag', function(event, d) {
                const dy = event.dy;
                d.y0 += dy;
                d.y1 += dy;
                d3.select(this).attr('transform', `translate(${d.x0},${d.y0})`);
                sankey.update(graph);
                link.attr('d', d3.sankeyLinkHorizontal());
            })
        );

    // Node rectangles
    node.append('rect')
        .attr('width', d => d.x1 - d.x0)
        .attr('height', d => Math.max(4, d.y1 - d.y0))
        .attr('fill', d => LAYER_COLORS[d.originalLayer !== undefined ? d.originalLayer : d.layer])
        .attr('stroke', 'rgba(255,255,255,0.2)')
        .attr('stroke-width', 0.5)
        .attr('rx', 3)
        .attr('ry', 3)
        .style('cursor', 'ns-resize')
        .on('mouseover', function(event, d) {
            d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1.5);
            showTooltip(event, `
                <div class="tt-title">${d.label}</div>
                <div class="tt-row">Type: ${d.type}</div>
                <div class="tt-row">Source: ${d.source}</div>
                <div class="tt-row">Layer: ${LAYER_NAMES[d.originalLayer !== undefined ? d.originalLayer : d.layer] || 'Unknown'}</div>
                ${d.status ? `<div class="tt-row">Status: ${d.status}</div>` : ''}
                ${d.key ? `<div class="tt-row">Key: ${d.key}</div>` : ''}
            `);
        })
        .on('mousemove', (event) => moveTooltip(event))
        .on('mouseout', function() {
            d3.select(this).attr('stroke', 'rgba(255,255,255,0.2)').attr('stroke-width', 0.5);
            hideTooltip();
        });

    // Node labels
    node.append('text')
        .attr('class', 'node-label')
        .attr('x', d => (d.x1 - d.x0) + 6)
        .attr('y', d => (d.y1 - d.y0) / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .text(d => {
            // Truncate long labels
            const maxLen = 30;
            return d.label.length > maxLen ? d.label.substring(0, maxLen) + '…' : d.label;
        })
        .each(function(d) {
            // If node is on the right side, put label on the left
            if (d.layer >= presentLayers.length - 2) {
                d3.select(this)
                    .attr('x', -6)
                    .attr('text-anchor', 'end');
            }
        });

    // Initial fit
    fitToContent(svg, zoomGroup, width, height, margin);
}

/**
 * Fit the diagram content to the viewport
 */
function fitToContent(svg, zoomGroup, width, height, margin) {
    const bounds = zoomGroup.node().getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;

    const fullWidth = bounds.width + 60;
    const fullHeight = bounds.height + 60;
    const scale = Math.min(
        width / fullWidth,
        height / fullHeight,
        1.2 // don't over-zoom
    );

    const tx = (width - bounds.width * scale) / 2 - bounds.x * scale;
    const ty = (height - bounds.height * scale) / 2 - bounds.y * scale;

    const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    svg.call(zoomBehavior.transform, transform);
}

/**
 * Reset zoom to fit content
 */
function resetZoom() {
    if (!svgElement || !zoomBehavior) return;
    const container = document.getElementById('chart-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    const zoomGroup = svgElement.select('.zoom-group');
    fitToContent(svgElement, zoomGroup, width, height, { top: 40, right: 30, bottom: 20, left: 30 });
}

function updateZoomInfo(scale) {
    document.getElementById('zoom-info').textContent =
        `Zoom: ${Math.round(scale * 100)}% • Scroll to zoom • Drag to pan`;
}

// ===== TOOLTIP =====

function showTooltip(event, html) {
    const tooltip = document.getElementById('tooltip');
    tooltip.innerHTML = html;
    tooltip.style.opacity = '1';
    moveTooltip(event);
}

function moveTooltip(event) {
    const tooltip = document.getElementById('tooltip');
    const x = event.clientX + 12;
    const y = event.clientY - 10;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip').style.opacity = '0';
}

// ===== DATA LOADING =====

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
            updateStatus(`❌ No data found for ${mdsoRef}. Try MDSO-1001 (sample data).`, 'error');
            return;
        }

        renderSankey(data, mdsoRef);
        showLoading(false);

        const nodeCount = data.nodes.length;
        const linkCount = data.links.length;
        updateStatus(`✅ ${mdsoRef} — ${nodeCount} nodes, ${linkCount} links`, 'success');
    } catch (err) {
        showLoading(false);
        updateStatus(`❌ Error: ${err.message}`, 'error');
        console.error('Traceability load error:', err);
    }
}

function importJSONFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            loadFromJSON(data);
        } catch (err) {
            updateStatus(`❌ Invalid JSON file: ${err.message}`, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        const data = JSON.parse(text);
        loadFromJSON(data);
    } catch (err) {
        updateStatus(`❌ Paste failed: ${err.message}. Copy JSON from the scraper first.`, 'error');
    }
}

function loadFromJSON(data) {
    if (!data.nodes || !data.links) {
        updateStatus('❌ Invalid format: expected { nodes: [...], links: [...] }', 'error');
        return;
    }

    // Assign layers based on node type (used for coloring and column placement)
    // But respect the actual link structure for positioning
    data.nodes.forEach(node => {
        const type = (node.type || '').toLowerCase();
        if (type.includes('objective')) node.layer = 0;
        else if (type.includes('initiative')) node.layer = 1;
        else if (type === 'project' || (type.includes('mdso') && type.includes('project'))) node.layer = 2;
        else if (type.includes('epic') || type.includes('feature')) node.layer = 3;
        else if (type.includes('story') || type.includes('task') || type.includes('bug') || type.includes('risk') || type.includes('request') || type.includes('problem') || type.includes('access')) node.layer = 4;
        else if (type === 'pr' || type.includes('pull')) node.layer = 5;
        else if (type.includes('release')) node.layer = 6;
        else if (type.includes('deploy')) node.layer = 7;
        else node.layer = 4; // Default to story layer
    });

    // For imported data, adjust layers so that links always flow forward.
    // If a link goes from a higher layer to a lower layer, bump the target up.
    const nodeMap = new Map(data.nodes.map(n => [n.id, n]));
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 20) {
        changed = false;
        iterations++;
        for (const link of data.links) {
            const src = nodeMap.get(link.source);
            const tgt = nodeMap.get(link.target);
            if (!src || !tgt) continue;
            if (src.layer >= tgt.layer) {
                tgt.layer = src.layer + 1;
                changed = true;
            }
        }
    }

    const mdsoRef = data.mdsoRef || 'Imported Data';
    document.getElementById('mdso-ref').value = mdsoRef;

    const sourceEl = document.getElementById('data-source');
    if (data.scrapedAt) {
        sourceEl.textContent = `Data: Scraped ${new Date(data.scrapedAt).toLocaleString()}`;
    } else {
        sourceEl.textContent = 'Data: Imported JSON';
    }

    renderSankey(data, mdsoRef);

    const nodeCount = data.nodes.length;
    const linkCount = data.links.length;
    updateStatus(`✅ ${mdsoRef} — ${nodeCount} nodes, ${linkCount} links (imported)`, 'success');
}

// ===== UTILS =====

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function updateStatus(message, type) {
    const el = document.getElementById('status-text');
    el.textContent = message;
    el.style.color = type === 'error' ? '#ef5350' : type === 'success' ? '#66bb6a' : '#78909c';
}

// ===== INIT =====

document.addEventListener('DOMContentLoaded', () => {
    buildLegend();
    loadDiagram();
});

document.getElementById('mdso-ref').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadDiagram();
});

// Handle window resize
window.addEventListener('resize', () => {
    if (svgElement) {
        resetZoom();
    }
});
