// ==UserScript==
// @name         MDSO Traceability Scraper
// @namespace    https://github.com/llira-mdsol/traceability-sankey
// @version      1.0.0
// @description  Scrape JIRA Cloud issue link hierarchy for Sankey diagram visualization
// @match        https://*.atlassian.net/browse/*
// @match        https://*.atlassian.net/jira/software/projects/*/boards/*
// @match        https://*.atlassian.net/jira/software/projects/*/issues/*
// @grant        GM_setClipboard
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ===== CONFIGURATION =====
    const CONFIG = {
        // Max depth to crawl from the starting issue
        maxDepth: 6,
        // Delay between requests to avoid rate limiting (ms)
        requestDelay: 300,
        // Max concurrent requests
        concurrency: 3,
        // Issue types at each layer (customize to match your JIRA setup)
        layerMapping: {
            'Objective': 0,
            'Initiative': 1,
            'MDSO Project': 2,
            'Epic': 3,
            'Feature': 3,
            'Story': 4,
            'Task': 4,
            'Sub-task': 4,
            'Bug': 4,
            'Pull Request': 5,
        },
        // Link types to follow (standard JIRA Cloud link types)
        linkTypes: {
            upward: ['is caused by', 'is part of', 'is child of', 'belongs to', 'is blocked by'],
            downward: ['causes', 'has part', 'is parent of', 'contains', 'blocks', 'implements'],
            // These go both directions
            bidirectional: ['relates to']
        }
    };

    // ===== STATE =====
    const visited = new Map(); // issueKey -> issue data
    const links = [];
    let totalRequests = 0;
    let completedRequests = 0;

    // ===== JIRA API HELPERS =====

    /**
     * Get the base URL for the current JIRA instance
     */
    function getBaseUrl() {
        return window.location.origin;
    }

    /**
     * Fetch an issue with its links using the browser's authenticated session.
     * JIRA Cloud REST API works with session cookies when called from the same origin.
     */
    async function fetchIssue(issueKey) {
        const url = `${getBaseUrl()}/rest/api/3/issue/${issueKey}?fields=summary,issuetype,status,issuelinks,parent,subtasks,project&expand=names`;
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            if (response.status === 404) return null;
            if (response.status === 429) {
                // Rate limited — wait and retry
                await sleep(2000);
                return fetchIssue(issueKey);
            }
            throw new Error(`Failed to fetch ${issueKey}: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Search for child issues (stories under an epic) using JQL
     */
    async function fetchChildIssues(parentKey) {
        const jql = encodeURIComponent(`parent = ${parentKey} OR "Epic Link" = ${parentKey}`);
        const url = `${getBaseUrl()}/rest/api/3/search?jql=${jql}&fields=key,summary,issuetype,status,issuelinks&maxResults=100`;
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            if (response.status === 429) {
                await sleep(2000);
                return fetchChildIssues(parentKey);
            }
            return [];
        }

        const data = await response.json();
        return data.issues || [];
    }

    /**
     * Search for PRs linked via development info (JIRA's dev panel)
     */
    async function fetchDevInfo(issueKey) {
        const url = `${getBaseUrl()}/rest/dev-status/latest/issue/detail?issueId=${issueKey}&applicationType=GitHub&dataType=pullrequest`;
        try {
            const response = await fetch(url, {
                credentials: 'same-origin',
                headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) return [];
            const data = await response.json();
            const prs = [];
            if (data.detail) {
                for (const repo of data.detail) {
                    for (const pr of (repo.pullRequests || [])) {
                        prs.push({
                            id: `pr-${pr.id}`,
                            name: pr.name || `PR #${pr.id}`,
                            url: pr.url,
                            status: pr.status,
                            repo: repo.name
                        });
                    }
                }
            }
            return prs;
        } catch {
            return [];
        }
    }

    // ===== CRAWL LOGIC =====

    /**
     * Determine the layer for an issue based on its type
     */
    function getLayer(issueType) {
        const normalized = issueType || 'Story';
        // Check exact match first
        if (CONFIG.layerMapping[normalized] !== undefined) {
            return CONFIG.layerMapping[normalized];
        }
        // Fuzzy match
        const lower = normalized.toLowerCase();
        if (lower.includes('objective')) return 0;
        if (lower.includes('initiative')) return 1;
        if (lower.includes('mdso') || lower.includes('project')) return 2;
        if (lower.includes('epic') || lower.includes('feature')) return 3;
        if (lower.includes('pr') || lower.includes('pull')) return 5;
        return 4; // Default to Story layer
    }

    /**
     * Process a single issue and extract its data
     */
    function processIssue(issue) {
        const key = issue.key;
        const fields = issue.fields;
        const issueType = fields.issuetype?.name || 'Unknown';
        const summary = fields.summary || key;
        const layer = getLayer(issueType);

        return {
            id: key.toLowerCase(),
            key: key,
            label: `${issueType.toUpperCase().substring(0, 4)}: ${summary}`,
            layer: layer,
            type: issueType,
            source: 'JIRA',
            status: fields.status?.name || 'Unknown'
        };
    }

    /**
     * Recursively crawl issue links
     */
    async function crawl(issueKey, depth = 0, direction = 'both') {
        if (depth > CONFIG.maxDepth) return;
        if (visited.has(issueKey)) return;

        updateUI(`Crawling ${issueKey} (depth ${depth})...`);
        totalRequests++;

        const issue = await fetchIssue(issueKey);
        if (!issue) {
            completedRequests++;
            return;
        }

        const nodeData = processIssue(issue);
        visited.set(issueKey, nodeData);
        completedRequests++;
        updateProgress();

        await sleep(CONFIG.requestDelay);

        const crawlPromises = [];

        // Process issue links
        const issueLinks = issue.fields.issuelinks || [];
        for (const link of issueLinks) {
            const linkType = link.type?.name || '';
            const inwardDesc = link.type?.inward || '';
            const outwardDesc = link.type?.outward || '';

            // Outward link (this issue -> linked issue)
            if (link.outwardIssue) {
                const targetKey = link.outwardIssue.key;
                const targetType = link.outwardIssue.fields?.issuetype?.name || 'Unknown';
                const targetLayer = getLayer(targetType);

                // Determine link direction in our hierarchy
                if (nodeData.layer <= targetLayer) {
                    // Going down the hierarchy
                    links.push({ source: nodeData.id, target: targetKey.toLowerCase(), value: 1 });
                } else {
                    // Going up
                    links.push({ source: targetKey.toLowerCase(), target: nodeData.id, value: 1 });
                }

                if (!visited.has(targetKey)) {
                    crawlPromises.push(() => crawl(targetKey, depth + 1, 'both'));
                }
            }

            // Inward link (linked issue -> this issue)
            if (link.inwardIssue) {
                const sourceKey = link.inwardIssue.key;
                const sourceType = link.inwardIssue.fields?.issuetype?.name || 'Unknown';
                const sourceLayer = getLayer(sourceType);

                if (sourceLayer <= nodeData.layer) {
                    // Source is higher in hierarchy
                    links.push({ source: sourceKey.toLowerCase(), target: nodeData.id, value: 1 });
                } else {
                    links.push({ source: nodeData.id, target: sourceKey.toLowerCase(), value: 1 });
                }

                if (!visited.has(sourceKey)) {
                    crawlPromises.push(() => crawl(sourceKey, depth + 1, 'both'));
                }
            }
        }

        // Process parent relationship
        if (issue.fields.parent) {
            const parentKey = issue.fields.parent.key;
            links.push({ source: parentKey.toLowerCase(), target: nodeData.id, value: 1 });
            if (!visited.has(parentKey)) {
                crawlPromises.push(() => crawl(parentKey, depth + 1, 'up'));
            }
        }

        // Process subtasks / epic children
        if (nodeData.layer <= 3) {
            const children = await fetchChildIssues(issueKey);
            for (const child of children) {
                const childKey = child.key;
                if (!visited.has(childKey)) {
                    const childNode = processIssue(child);
                    visited.set(childKey, childNode);
                    links.push({ source: nodeData.id, target: childKey.toLowerCase(), value: 1 });
                    crawlPromises.push(() => crawl(childKey, depth + 1, 'down'));
                }
            }
        }

        // Fetch PR info for stories
        if (nodeData.layer >= 4) {
            const issueId = issue.id; // numeric ID needed for dev-status
            const prs = await fetchDevInfo(issueId);
            for (const pr of prs) {
                if (!visited.has(pr.id)) {
                    visited.set(pr.id, {
                        id: pr.id,
                        key: pr.id,
                        label: `PR: ${pr.name}`,
                        layer: 5,
                        type: 'PR',
                        source: 'GitHub',
                        status: pr.status,
                        url: pr.url
                    });
                    links.push({ source: nodeData.id, target: pr.id, value: 1 });
                }
            }
        }

        // Execute crawl promises with concurrency limit
        await executeWithConcurrency(crawlPromises, CONFIG.concurrency);
    }

    // ===== UTILITIES =====

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function executeWithConcurrency(tasks, limit) {
        const executing = [];
        for (const task of tasks) {
            const p = task();
            executing.push(p);
            if (executing.length >= limit) {
                await Promise.race(executing);
                executing.splice(executing.findIndex(e => e), 1);
            }
        }
        await Promise.all(executing);
    }

    // ===== OUTPUT =====

    /**
     * Build the final JSON output compatible with the Sankey diagram app
     */
    function buildOutput(startKey) {
        const nodes = Array.from(visited.values());

        // Deduplicate links and remove any that reference missing nodes
        const nodeIds = new Set(nodes.map(n => n.id));
        const uniqueLinks = [];
        const linkSet = new Set();

        for (const link of links) {
            const key = `${link.source}|${link.target}`;
            if (!linkSet.has(key) && nodeIds.has(link.source) && nodeIds.has(link.target)) {
                // Ensure links flow from lower layer number to higher
                const srcNode = visited.get(link.source) || visited.get(link.source.toUpperCase());
                const tgtNode = visited.get(link.target) || visited.get(link.target.toUpperCase());

                if (srcNode && tgtNode && srcNode.layer < tgtNode.layer) {
                    linkSet.add(key);
                    uniqueLinks.push(link);
                } else if (srcNode && tgtNode && srcNode.layer > tgtNode.layer) {
                    // Flip it
                    const reverseKey = `${link.target}|${link.source}`;
                    if (!linkSet.has(reverseKey)) {
                        linkSet.add(reverseKey);
                        uniqueLinks.push({ source: link.target, target: link.source, value: link.value });
                    }
                }
                // Skip same-layer links (or optionally include as value=0.5)
            }
        }

        return {
            mdsoRef: startKey,
            scrapedAt: new Date().toISOString(),
            nodes: nodes,
            links: uniqueLinks
        };
    }

    // ===== UI =====

    function createUI() {
        const panel = document.createElement('div');
        panel.id = 'mdso-scraper-panel';
        panel.innerHTML = `
            <style>
                #mdso-scraper-panel {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 999999;
                    background: #1a1a2e;
                    border: 1px solid #4fc3f7;
                    border-radius: 8px;
                    padding: 16px;
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    font-size: 13px;
                    color: #e0e0e0;
                    width: 320px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                }
                #mdso-scraper-panel h3 {
                    margin: 0 0 12px 0;
                    color: #4fc3f7;
                    font-size: 14px;
                }
                #mdso-scraper-panel .btn {
                    background: #0f3460;
                    color: #4fc3f7;
                    border: 1px solid #4fc3f7;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    width: 100%;
                    margin-top: 8px;
                }
                #mdso-scraper-panel .btn:hover {
                    background: #1a4a7a;
                }
                #mdso-scraper-panel .btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                #mdso-scraper-panel .btn.success {
                    border-color: #66bb6a;
                    color: #66bb6a;
                }
                #mdso-scraper-panel .status {
                    margin-top: 8px;
                    padding: 8px;
                    background: #0d1b2a;
                    border-radius: 4px;
                    font-size: 11px;
                    max-height: 80px;
                    overflow-y: auto;
                }
                #mdso-scraper-panel .progress-bar {
                    height: 4px;
                    background: #0d1b2a;
                    border-radius: 2px;
                    margin-top: 8px;
                    overflow: hidden;
                }
                #mdso-scraper-panel .progress-fill {
                    height: 100%;
                    background: #4fc3f7;
                    width: 0%;
                    transition: width 0.3s;
                }
                #mdso-scraper-panel .close-btn {
                    position: absolute;
                    top: 8px;
                    right: 12px;
                    background: none;
                    border: none;
                    color: #78909c;
                    cursor: pointer;
                    font-size: 16px;
                }
            </style>
            <button class="close-btn" onclick="document.getElementById('mdso-scraper-panel').style.display='none'">✕</button>
            <h3>🔗 Traceability Scraper</h3>
            <div id="scraper-issue-key" style="color:#78909c; margin-bottom:8px;"></div>
            <button class="btn" id="scraper-start-btn">Scrape Hierarchy</button>
            <button class="btn" id="scraper-copy-btn" style="display:none;">Copy JSON to Clipboard</button>
            <button class="btn" id="scraper-download-btn" style="display:none;">Download JSON File</button>
            <div class="progress-bar"><div class="progress-fill" id="scraper-progress"></div></div>
            <div class="status" id="scraper-status">Ready. Navigate to an MDSO project issue and click Scrape.</div>
        `;
        document.body.appendChild(panel);

        document.getElementById('scraper-start-btn').addEventListener('click', startScrape);
        document.getElementById('scraper-copy-btn').addEventListener('click', copyToClipboard);
        document.getElementById('scraper-download-btn').addEventListener('click', downloadJSON);

        // Detect current issue key
        detectCurrentIssue();
    }

    function detectCurrentIssue() {
        // Extract issue key from URL
        const match = window.location.pathname.match(/browse\/([A-Z]+-\d+)/i) ||
                      window.location.pathname.match(/issues\/([A-Z]+-\d+)/i);
        if (match) {
            const key = match[1].toUpperCase();
            document.getElementById('scraper-issue-key').textContent = `Current issue: ${key}`;
            return key;
        }
        document.getElementById('scraper-issue-key').textContent = 'Navigate to an issue to scrape';
        return null;
    }

    function updateUI(message) {
        const el = document.getElementById('scraper-status');
        if (el) el.textContent = message;
    }

    function updateProgress() {
        const el = document.getElementById('scraper-progress');
        if (el && totalRequests > 0) {
            el.style.width = `${(completedRequests / totalRequests) * 100}%`;
        }
    }

    let outputData = null;

    async function startScrape() {
        const issueKey = detectCurrentIssue();
        if (!issueKey) {
            updateUI('❌ No issue detected. Navigate to a JIRA issue first.');
            return;
        }

        // Reset state
        visited.clear();
        links.length = 0;
        totalRequests = 0;
        completedRequests = 0;
        outputData = null;

        const btn = document.getElementById('scraper-start-btn');
        btn.disabled = true;
        btn.textContent = 'Scraping...';
        document.getElementById('scraper-copy-btn').style.display = 'none';
        document.getElementById('scraper-download-btn').style.display = 'none';

        try {
            await crawl(issueKey, 0, 'both');

            outputData = buildOutput(issueKey);
            const nodeCount = outputData.nodes.length;
            const linkCount = outputData.links.length;

            updateUI(`✅ Done! ${nodeCount} nodes, ${linkCount} links scraped.`);
            document.getElementById('scraper-copy-btn').style.display = 'block';
            document.getElementById('scraper-download-btn').style.display = 'block';

            btn.textContent = 'Re-scrape';
            btn.disabled = false;

            console.log('[Traceability Scraper] Output:', outputData);
        } catch (err) {
            updateUI(`❌ Error: ${err.message}`);
            btn.textContent = 'Retry Scrape';
            btn.disabled = false;
            console.error('[Traceability Scraper]', err);
        }
    }

    function copyToClipboard() {
        if (!outputData) return;
        const json = JSON.stringify(outputData, null, 2);

        if (typeof GM_setClipboard !== 'undefined') {
            GM_setClipboard(json, 'text');
            updateUI('📋 Copied to clipboard! Paste into the Sankey app.');
        } else {
            navigator.clipboard.writeText(json).then(() => {
                updateUI('📋 Copied to clipboard! Paste into the Sankey app.');
            }).catch(() => {
                // Fallback: open in new tab
                const blob = new Blob([json], { type: 'application/json' });
                window.open(URL.createObjectURL(blob));
                updateUI('Opened JSON in new tab (clipboard not available).');
            });
        }
    }

    function downloadJSON() {
        if (!outputData) return;
        const json = JSON.stringify(outputData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `traceability-${outputData.mdsoRef}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        updateUI(`💾 Downloaded ${a.download}`);
    }

    // ===== INIT =====
    createUI();

})();
