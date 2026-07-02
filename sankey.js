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
        return;
    }

    // Remap layers to be contiguous (d3-sankey crashes on gaps in layer indices)
    const presentLayers = [...new Set(filteredNodes.map(n => n.layer))].sort((a, b) => a - b);
    const layerRemap = new Map(presentLayers.map((layer, idx) => [layer, idx]));
    filteredNodes.forEach(n => {
        n.originalLayer = n.layer;
        n.layer = layerRemap.get(n.layer);
    });

    // Add ghost anchor nodes to force d3-sankey to respect column placement.
    // d3-sankey ignores nodeAlign for leaf nodes (pushes them to max depth).
    // Ghost nodes with tiny links through every column prevent this.
    const numRemappedLayers = presentLayers.length;
    for (let i = 0; i < numRemappedLayers; i++) {
        filteredNodes.push({
            id: `__ghost_${i}`,
            label: '',
            layer: i,
            originalLayer: presentLayers[i],
            type: '__ghost',
            source: '',
            _ghost: true
        });
    }
    for (let i = 0; i < numRemappedLayers - 1; i++) {
        sankeyLinks.push({
            source: `__ghost_${i}`,
            target: `__ghost_${i + 1}`,
            value: 0.001
        });
    }

    console.log('[Sankey] Rendering:', filteredNodes.length, 'nodes,', sankeyLinks.length, 'links');
    console.log('[Sankey] Layer dist:', filteredNodes.reduce((acc, n) => { acc[n.layer] = (acc[n.layer] || 0) + 1; return acc; }, {}));
    console.log('[Sankey] Layer remap:', Object.fromEntries(layerRemap));

    // Configure sankey layout
    const numLayers = Object.keys(LAYERS).length;
    // Adapt padding based on dataset size
    const maxNodesInLayer = Math.max(...Object.values(
        filteredNodes.reduce((acc, n) => { acc[n.layer] = (acc[n.layer] || 0) + 1; return acc; }, {})
    ));
    const adaptivePadding = maxNodesInLayer > 100 ? 1 : maxNodesInLayer > 50 ? 2 : maxNodesInLayer > 20 ? 6 : 14;
    // For large datasets, use proportional virtual dimensions
    // Make width much wider than height to spread columns apart
    const numColumns = presentLayers.length;
    const virtualHeight = Math.max(innerHeight, maxNodesInLayer * (adaptivePadding + 3));
    const virtualWidth = Math.max(innerWidth, numColumns * 500);

    console.log('[Sankey] Max nodes in layer:', maxNodesInLayer, '| Padding:', adaptivePadding, '| Virtual:', virtualWidth, 'x', virtualHeight);

    const sankey = d3.sankey()
        .nodeId(d => d.id)
        .nodeWidth(18)
        .nodePadding(adaptivePadding)
        .nodeSort(null)
        .nodeAlign((node, n) => {
            // Force nodes into their layer column
            const layer = node.layer !== undefined ? node.layer : 2;
            return layer;
        })
        .extent([[0, 0], [virtualWidth, virtualHeight]]);

    // Compute layout
    let graph;
    try {
        graph = sankey({
            nodes: filteredNodes.map(d => ({ ...d })),
            links: sankeyLinks.map(d => ({ ...d }))
        });
        console.log('[Sankey] Layout computed:', graph.nodes.length, 'nodes positioned');
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

    // Layer headers — derive from actual node types in each column
    const columnInfo = {};
    graph.nodes.filter(n => !n._ghost).forEach(node => {
        const col = node.x0; // x position groups nodes into columns
        const colKey = Math.round(col);
        if (!columnInfo[colKey]) {
            columnInfo[colKey] = { x0: node.x0, x1: node.x1, types: new Set() };
        }
        columnInfo[colKey].types.add(node.type);
        columnInfo[colKey].x0 = Math.min(columnInfo[colKey].x0, node.x0);
        columnInfo[colKey].x1 = Math.max(columnInfo[colKey].x1, node.x1);
    });

    for (const [, info] of Object.entries(columnInfo)) {
        const centerX = (info.x0 + info.x1) / 2;
        const typeLabel = [...info.types].join(' / ');
        // Pick color from first type
        const sampleType = [...info.types][0];
        const color = getNodeColor({ type: sampleType });
        g.append('text')
            .attr('class', 'layer-header')
            .attr('x', centerX)
            .attr('y', -15)
            .attr('fill', color)
            .text(typeLabel);
    }

    // Draw links (exclude ghost links)
    const link = g.append('g')
        .attr('fill', 'none')
        .attr('stroke-opacity', 0.35)
        .selectAll('path')
        .data(graph.links.filter(d => !d.source._ghost && !d.target._ghost))
        .join('path')
        .attr('d', d3.sankeyLinkHorizontal())
        .attr('stroke', d => getNodeColor(d.source))
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

    // Draw nodes (exclude ghost nodes)
    const node = g.append('g')
        .selectAll('g')
        .data(graph.nodes.filter(d => !d._ghost))
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
        .attr('fill', d => getNodeColor(d))
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
                <div class="tt-row">Layer: ${d.type}</div>
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
 * Get color for a node based on its type (works regardless of layer number)
 */
function getNodeColor(node) {
    const type = (node.type || '').toLowerCase();
    if (type.includes('objective')) return '#e57373';
    if (type.includes('initiative')) return '#ffb74d';
    if (type === 'project' || type.includes('mdso')) return '#fff176';
    if (type.includes('epic') || type.includes('feature')) return '#81c784';
    if (type.includes('story')) return '#4fc3f7';
    if (type.includes('task')) return '#4dd0e1';
    if (type.includes('bug')) return '#ff8a65';
    if (type.includes('risk') || type.includes('problem') || type.includes('request') || type.includes('access')) return '#a1887f';
    if (type === 'pr' || type.includes('pull')) return '#ce93d8';
    if (type.includes('release')) return '#dce775';
    if (type.includes('deploy')) return '#7986cb';
    return '#90a4ae'; // fallback gray
}


function fitToContent(svg, zoomGroup, width, height, margin) {
    const bounds = zoomGroup.node().getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;

    // Fit to width so all columns are visible; user pans vertically
    const scale = Math.min((width - 40) / bounds.width, 1.5);

    const tx = 20 - bounds.x * scale;
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

    // Assign each type to its own column for maximum separation
    const TYPE_TO_LAYER = {
        'objective': 0,
        'initiative': 1,
        'project': 2,
        'epic': 3,
        'feature': 3,
        'story': 4,
        'p story': 4,
        'task': 5,
        'p task': 5,
        'bug': 6,
        'risk': 7,
        'request': 7,
        'problem': 7,
        'hosting access': 7,
        'pr': 8,
        'pull request': 8,
        'release': 9,
        'deployment': 10,
    };

    data.nodes.forEach(node => {
        const type = (node.type || '').toLowerCase();
        if (TYPE_TO_LAYER[type] !== undefined) {
            node.layer = TYPE_TO_LAYER[type];
        } else {
            // Fuzzy match
            if (type.includes('objective')) node.layer = 0;
            else if (type.includes('initiative')) node.layer = 1;
            else if (type.includes('project')) node.layer = 2;
            else if (type.includes('epic') || type.includes('feature')) node.layer = 3;
            else if (type.includes('story')) node.layer = 4;
            else if (type.includes('task')) node.layer = 5;
            else if (type.includes('bug')) node.layer = 6;
            else if (type.includes('release')) node.layer = 9;
            else if (type.includes('deploy')) node.layer = 10;
            else if (type === 'pr' || type.includes('pull')) node.layer = 8;
            else node.layer = 5;
        }
    });

    // Propagate: ensure all links flow forward
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

// ===== EXPORT =====

/**
 * Export the diagram as a PNG image
 */
function exportImage() {
    const svgEl = document.getElementById('sankey-chart');
    if (!svgEl || !svgEl.querySelector('g')) {
        updateStatus('⚠️ Nothing to export — load data first', 'error');
        return;
    }

    updateStatus('Exporting PNG...', 'loading');

    // Clone SVG and prepare for export
    const clone = svgEl.cloneNode(true);
    const bounds = svgEl.querySelector('.zoom-group').getBBox();
    const transform = svgEl.querySelector('.zoom-group').getAttribute('transform');

    // Set viewBox to capture full content with padding
    const padding = 40;
    clone.setAttribute('width', bounds.width + padding * 2);
    clone.setAttribute('height', bounds.height + padding * 2);
    clone.setAttribute('viewBox', `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`);

    // Remove zoom transform so we get the full unzoomed diagram
    const zoomGroup = clone.querySelector('.zoom-group');
    if (zoomGroup) {
        zoomGroup.removeAttribute('transform');
    }

    // Add background
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', bounds.x - padding);
    bg.setAttribute('y', bounds.y - padding);
    bg.setAttribute('width', bounds.width + padding * 2);
    bg.setAttribute('height', bounds.height + padding * 2);
    bg.setAttribute('fill', '#1a1a2e');
    clone.insertBefore(bg, clone.firstChild);

    // Add inline styles for text
    clone.querySelectorAll('.node-label').forEach(el => {
        el.style.fontSize = '10px';
        el.style.fill = '#b0bec5';
    });
    clone.querySelectorAll('.layer-header').forEach(el => {
        el.style.fontSize = '11px';
        el.style.fontWeight = '600';
    });

    // Serialize SVG
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    // Render to canvas
    const img = new Image();
    img.onload = () => {
        const scale = 2; // 2x resolution for clarity
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        // Download
        canvas.toBlob(blob => {
            const a = document.createElement('a');
            const mdsoRef = document.getElementById('mdso-ref').value || 'diagram';
            a.download = `traceability-${mdsoRef}-${new Date().toISOString().slice(0, 10)}.png`;
            a.href = URL.createObjectURL(blob);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            updateStatus(`✅ Exported ${a.download}`, 'success');
        }, 'image/png');
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        updateStatus('❌ PNG export failed. Try SVG export instead.', 'error');
    };
    img.src = url;
}

/**
 * Export the diagram as an SVG file
 */
function exportSVG() {
    const svgEl = document.getElementById('sankey-chart');
    if (!svgEl || !svgEl.querySelector('g')) {
        updateStatus('⚠️ Nothing to export — load data first', 'error');
        return;
    }

    // Clone SVG and prepare for export
    const clone = svgEl.cloneNode(true);
    const bounds = svgEl.querySelector('.zoom-group').getBBox();

    // Set viewBox to capture full content
    const padding = 40;
    clone.setAttribute('width', bounds.width + padding * 2);
    clone.setAttribute('height', bounds.height + padding * 2);
    clone.setAttribute('viewBox', `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // Remove zoom transform
    const zoomGroup = clone.querySelector('.zoom-group');
    if (zoomGroup) {
        zoomGroup.removeAttribute('transform');
    }

    // Add background
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', bounds.x - padding);
    bg.setAttribute('y', bounds.y - padding);
    bg.setAttribute('width', bounds.width + padding * 2);
    bg.setAttribute('height', bounds.height + padding * 2);
    bg.setAttribute('fill', '#1a1a2e');
    clone.insertBefore(bg, clone.firstChild);

    // Add styles inline
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
        .node-label { font: 10px -apple-system, sans-serif; fill: #b0bec5; }
        .layer-header { font: 600 11px -apple-system, sans-serif; }
    `;
    clone.insertBefore(style, clone.firstChild);

    // Serialize and download
    const serializer = new XMLSerializer();
    const svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(clone);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    const mdsoRef = document.getElementById('mdso-ref').value || 'diagram';
    a.download = `traceability-${mdsoRef}-${new Date().toISOString().slice(0, 10)}.svg`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    updateStatus(`✅ Exported ${a.download}`, 'success');
}
