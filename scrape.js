#!/usr/bin/env node
/**
 * MDSO Traceability Scraper — Playwright CLI
 *
 * Usage:
 *   npx playwright install chromium   # first time only
 *   node scrape.js MDSO-25672         # scrape a specific project
 *   node scrape.js MDSO-25672 --login # force re-login
 *
 * Strategy:
 *   1. Login phase: Opens a browser for manual login, extracts session cookies
 *   2. Scrape phase: Uses pure HTTP requests (no page rendering) with those cookies
 *
 * This avoids page crashes from JIRA's heavy frontend.
 */

const { firefox, request } = require('playwright');
const fs = require('fs');
const path = require('path');

// ===== CONFIGURATION =====
const CONFIG = {
    jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://jira.mdsol.com',

    // Where to save cookies between runs
    cookieFile: path.join(__dirname, '.auth-cookies.json'),

    // Output directory for scraped JSON
    outputDir: path.join(__dirname, 'output'),

    // Crawl settings
    maxDepth: 6,
    requestDelay: 400,

    // Issue type → layer mapping
    // Flow: Objectives(0) → Initiatives(1) → MDSO Projects(2) → Epics/Features(3) → Stories(4) → PRs(5) → Releases(6) → Deployments(7)
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
        'Release': 6,
        'MDSO Release': 6,
        'Deployment': 7,
        'Deploy': 7,
        'IH Deploy': 7,
    },

    // REST API version ('2' for Server/DC, '3' for Cloud)
    apiVersion: '2',
};

// ===== STATE =====
const visited = new Map();
const links = [];
let totalRequests = 0;
let completedRequests = 0;

// ===== CLI ARGS =====
const args = process.argv.slice(2);
const issueKey = args.find(a => !a.startsWith('--'));
const forceLogin = args.includes('--login');
const showBrowser = args.includes('--headed');

if (!issueKey) {
    console.error('Usage: node scrape.js <MDSO-KEY> [--login] [--headed]');
    console.error('  e.g. node scrape.js MDSO-25672');
    console.error('');
    console.error('Options:');
    console.error('  --login   Force re-login (clear saved session)');
    console.error('  --headed  Show the browser window during login');
    process.exit(1);
}

// ===== MAIN =====
async function main() {
    console.log(`\n🔗 Traceability Scraper — ${issueKey}`);
    console.log(`   JIRA: ${CONFIG.jiraBaseUrl}\n`);

    // Clear cookies if forced
    if (forceLogin && fs.existsSync(CONFIG.cookieFile)) {
        fs.unlinkSync(CONFIG.cookieFile);
        console.log('   Cleared saved cookies.\n');
    }

    // Ensure output dir exists
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });

    // Get authenticated cookies (login if needed)
    const cookies = await getAuthCookies();

    // Create an API context using those cookies (pure HTTP — no browser page needed)
    const apiContext = await request.newContext({
        baseURL: CONFIG.jiraBaseUrl,
        extraHTTPHeaders: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        storageState: {
            cookies: cookies,
            origins: []
        },
        ignoreHTTPSErrors: true,
    });

    // Verify session works
    const myself = await apiGet(apiContext, `/rest/api/${CONFIG.apiVersion}/myself`);
    if (!myself || myself.error) {
        console.error('   ❌ Session invalid. Run again with --login');
        await apiContext.dispose();
        process.exit(1);
    }
    console.log(`   ✅ Authenticated as: ${myself.displayName || myself.name}\n`);

    // Crawl the issue hierarchy
    // Phase 1: Fetch the starting MDSO project to get:
    //   - Directly linked epics (only these will be included)
    //   - Epic Link field value (Objective)
    console.log('   Phase 1: Fetching MDSO project and direct links...\n');
    const startIssue = await fetchIssue(apiContext, issueKey.toUpperCase());
    if (!startIssue) {
        console.error(`   ❌ Could not fetch ${issueKey}`);
        await apiContext.dispose();
        process.exit(1);
    }

    const startNode = processIssue(startIssue);
    visited.set(issueKey.toUpperCase(), startNode);

    // Extract Objective from Epic Link custom field
    const epicLinkValue = startIssue.fields?.customfield_10008
        || startIssue.fields?.customfield_10006
        || startIssue.fields?.customfield_10014;

    if (epicLinkValue) {
        const objLabel = typeof epicLinkValue === 'string' ? epicLinkValue : (epicLinkValue.name || epicLinkValue.value || JSON.stringify(epicLinkValue));
        const objId = '__objective__';
        visited.set(objId, {
            id: objId,
            key: 'Objective',
            label: `OBJ: ${objLabel}`,
            layer: 0,
            type: 'Objective',
            source: 'JIRA (Epic Link)',
            status: ''
        });
        links.push({ source: objId, target: startNode.id, value: 1 });
        console.log(`   📎 Objective (Epic Link): ${objLabel}\n`);
    }

    // Identify directly linked epics from the MDSO project issue links
    const directlyLinkedEpics = new Set();
    const issueLinks = startIssue.fields?.issuelinks || [];

    for (const link of issueLinks) {
        const linked = link.outwardIssue || link.inwardIssue;
        if (!linked) continue;
        const linkedType = linked.fields?.issuetype?.name || '';
        const linkedKey = linked.key;

        if (linkedType === 'Epic') {
            directlyLinkedEpics.add(linkedKey);
            links.push({ source: startNode.id, target: linkedKey.toLowerCase(), value: 1 });
        } else {
            // Non-epic links (Releases, etc.) - add directly
            const targetLayer = getLayer(linkedType);
            if (startNode.layer <= targetLayer) {
                links.push({ source: startNode.id, target: linkedKey.toLowerCase(), value: 1 });
            } else {
                links.push({ source: linkedKey.toLowerCase(), target: startNode.id, value: 1 });
            }
            if (!visited.has(linkedKey)) {
                // Crawl non-epic links normally
                await crawl(apiContext, linkedKey, 1);
            }
        }
    }

    console.log(`   📌 Directly linked epics: ${directlyLinkedEpics.size}`);
    console.log(`   ${[...directlyLinkedEpics].join(', ')}\n`);

    // Phase 2: Crawl only the directly linked epics and their children
    console.log('   Phase 2: Crawling directly linked epics...\n');
    for (const epicKey of directlyLinkedEpics) {
        await crawl(apiContext, epicKey, 1);
    }

    // Build output
    const output = buildOutput(issueKey.toUpperCase());

    // Save to file
    const filename = `traceability-${issueKey.toUpperCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    const outputPath = path.join(CONFIG.outputDir, filename);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`\n✅ Done!`);
    console.log(`   Nodes: ${output.nodes.length}`);
    console.log(`   Links: ${output.links.length}`);
    console.log(`   Output: ${outputPath}\n`);

    await apiContext.dispose();
}

// ===== AUTH =====

/**
 * Get cookies — either from saved file or by launching a browser for login.
 */
async function getAuthCookies() {
    // Try saved cookies first
    if (fs.existsSync(CONFIG.cookieFile)) {
        const cookies = JSON.parse(fs.readFileSync(CONFIG.cookieFile, 'utf8'));
        console.log('   Using saved session cookies...');
        return cookies;
    }

    // Need to login via browser
    console.log('🔐 Login required. Opening browser...');
    console.log('   Log in to JIRA manually. The browser will close automatically.\n');

    const browser = await firefox.launch({
        headless: false, // Always show browser for login
    });

    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // Navigate to JIRA login
    await page.goto(CONFIG.jiraBaseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Poll until authenticated — use a second tab to hit the API directly
    console.log('   Waiting for login to complete (polling every 5s)...');
    console.log('   (Complete login in the browser, then wait for detection)\n');
    const maxWait = 300000;
    const startTime = Date.now();
    let loggedIn = false;
    let savedCookies = null;

    while (Date.now() - startTime < maxWait) {
        await sleep(5000);

        try {
            // Open API endpoint in a new tab (shares cookies with main page)
            const apiPage = await context.newPage();
            const resp = await apiPage.goto(
                `${CONFIG.jiraBaseUrl}/rest/api/${CONFIG.apiVersion}/myself`,
                { waitUntil: 'commit', timeout: 10000 }
            );

            if (resp && resp.status() === 200) {
                const body = await apiPage.evaluate(() => document.body?.innerText || '');
                await apiPage.close();

                try {
                    const data = JSON.parse(body);
                    if (data.displayName || data.name) {
                        console.log(`   ✅ Login detected: ${data.displayName || data.name}`);
                        loggedIn = true;

                        // Extract and save cookies
                        savedCookies = await context.cookies();
                        fs.writeFileSync(CONFIG.cookieFile, JSON.stringify(savedCookies, null, 2));
                        console.log('   Cookies saved.\n');
                        break;
                    }
                } catch {
                    // Not JSON — probably login page redirect
                }
            } else {
                await apiPage.close();
            }
        } catch {
            // Page may have crashed or timed out — that's ok, keep polling
        }
        process.stdout.write('.');
    }

    await browser.close();

    if (!loggedIn) {
        throw new Error('Login timed out after 5 minutes. Try again.');
    }

    return savedCookies;
}

// ===== HTTP API =====

/**
 * Make a GET request using the API context (pure HTTP, no browser page).
 */
async function apiGet(apiContext, endpoint) {
    try {
        const resp = await apiContext.get(endpoint);
        if (resp.status() === 429) {
            console.log(`   ⏳ Rate limited, waiting 3s...`);
            await sleep(3000);
            return apiGet(apiContext, endpoint);
        }
        if (resp.status() === 404) return null;
        if (!resp.ok()) {
            return { error: resp.status(), statusText: resp.statusText() };
        }
        return await resp.json();
    } catch (err) {
        return { error: 0, statusText: err.message };
    }
}

async function fetchIssue(apiContext, key) {
    const data = await apiGet(apiContext, `/rest/api/${CONFIG.apiVersion}/issue/${key}?fields=summary,issuetype,status,issuelinks,parent,subtasks,project,customfield_10008,customfield_10014,customfield_10006`);
    // customfield_10008 = Epic Link (common), customfield_10014 = Epic Name, customfield_10006 = Epic Link (alt)
    if (data?.error) {
        if (data.error !== 404) {
            console.warn(`   ⚠️  Failed to fetch ${key}: ${data.error} ${data.statusText || ''}`);
        }
        return null;
    }
    return data;
}

async function fetchChildIssues(apiContext, parentKey) {
    const jql = encodeURIComponent(`parent = ${parentKey} OR "Epic Link" = ${parentKey}`);
    const data = await apiGet(apiContext, `/rest/api/${CONFIG.apiVersion}/search?jql=${jql}&fields=key,summary,issuetype,status,issuelinks&maxResults=100`);
    if (data?.error) return [];
    return data?.issues || [];
}

async function fetchDevInfo(apiContext, issueId) {
    const data = await apiGet(apiContext, `/rest/dev-status/latest/issue/detail?issueId=${issueId}&applicationType=GitHub&dataType=pullrequest`);
    if (data?.error) return [];

    const prs = [];
    if (data?.detail) {
        for (const repo of data.detail) {
            for (const pr of (repo.pullRequests || [])) {
                prs.push({
                    id: `pr-${pr.id || pr.name?.replace(/\s+/g, '-').toLowerCase()}`,
                    name: pr.name || `PR #${pr.id}`,
                    url: pr.url,
                    status: pr.status,
                    repo: repo.name
                });
            }
        }
    }
    return prs;
}

// ===== CRAWL LOGIC =====

function getLayer(issueType) {
    const normalized = issueType || 'Story';
    if (CONFIG.layerMapping[normalized] !== undefined) {
        return CONFIG.layerMapping[normalized];
    }
    const lower = normalized.toLowerCase();
    if (lower.includes('objective')) return 0;
    if (lower.includes('initiative')) return 1;
    if (lower.includes('mdso') && lower.includes('project')) return 2;
    if (lower.includes('epic') || lower.includes('feature')) return 3;
    if (lower.includes('release')) return 6;
    if (lower.includes('deploy')) return 7;
    if (lower.includes('pr') || lower.includes('pull')) return 5;
    return 4; // Default to Story layer
}

function processIssue(issue) {
    const key = issue.key;
    const fields = issue.fields;
    const issueType = fields.issuetype?.name || 'Unknown';
    const summary = fields.summary || key;
    const layer = getLayer(issueType);

    // Capture Epic Link field (Objective) if present
    const epicLink = fields.customfield_10008 || fields.customfield_10006 || fields.customfield_10014;

    const node = {
        id: key.toLowerCase(),
        key: key,
        label: `${issueType.toUpperCase().substring(0, 4)}: ${summary}`,
        layer: layer,
        type: issueType,
        source: 'JIRA',
        status: fields.status?.name || 'Unknown'
    };

    if (epicLink) {
        node.epicLink = typeof epicLink === 'string' ? epicLink : (epicLink.name || epicLink.value || JSON.stringify(epicLink));
    }

    return node;
}

async function crawl(apiContext, key, depth) {
    if (depth > CONFIG.maxDepth) return;
    if (visited.has(key)) return;

    totalRequests++;
    const progress = `[${completedRequests}/${totalRequests}]`;
    const indent = '  '.repeat(Math.min(depth, 4));
    process.stdout.write(`\r   ${progress} ${indent}${key}...`);

    const issue = await fetchIssue(apiContext, key);
    if (!issue) {
        completedRequests++;
        return;
    }

    const nodeData = processIssue(issue);
    visited.set(key, nodeData);
    completedRequests++;

    process.stdout.write(`\r   [${completedRequests}/${totalRequests}] ${indent}${key} (${nodeData.type})          \n`);

    await sleep(CONFIG.requestDelay);

    // Process issue links
    const issueLinks = issue.fields?.issuelinks || [];
    const toCrawl = [];

    for (const link of issueLinks) {
        if (link.outwardIssue) {
            const targetKey = link.outwardIssue.key;
            const targetType = link.outwardIssue.fields?.issuetype?.name || 'Unknown';
            const targetLayer = getLayer(targetType);

            // Skip epic links from non-starting projects (those are handled in Phase 1)
            if (nodeData.type === 'Project' && targetType === 'Epic') continue;

            if (nodeData.layer <= targetLayer) {
                links.push({ source: nodeData.id, target: targetKey.toLowerCase(), value: 1 });
            } else {
                links.push({ source: targetKey.toLowerCase(), target: nodeData.id, value: 1 });
            }

            if (!visited.has(targetKey)) {
                toCrawl.push(targetKey);
            }
        }

        if (link.inwardIssue) {
            const sourceKey = link.inwardIssue.key;
            const sourceType = link.inwardIssue.fields?.issuetype?.name || 'Unknown';
            const sourceLayer = getLayer(sourceType);

            // Skip epic links from non-starting projects
            if (nodeData.type === 'Project' && sourceType === 'Epic') continue;

            if (sourceLayer <= nodeData.layer) {
                links.push({ source: sourceKey.toLowerCase(), target: nodeData.id, value: 1 });
            } else {
                links.push({ source: nodeData.id, target: sourceKey.toLowerCase(), value: 1 });
            }

            if (!visited.has(sourceKey)) {
                toCrawl.push(sourceKey);
            }
        }
    }

    // Parent relationship
    if (issue.fields?.parent) {
        const parentKey = issue.fields.parent.key;
        links.push({ source: parentKey.toLowerCase(), target: nodeData.id, value: 1 });
        if (!visited.has(parentKey)) {
            toCrawl.push(parentKey);
        }
    }

    // Child issues (for epics and above)
    if (nodeData.layer <= 3) {
        const children = await fetchChildIssues(apiContext, key);
        for (const child of children) {
            const childKey = child.key;
            if (!visited.has(childKey)) {
                const childNode = processIssue(child);
                visited.set(childKey, childNode);
                links.push({ source: nodeData.id, target: childKey.toLowerCase(), value: 1 });
                toCrawl.push(childKey);
            }
        }
    }

    // PRs for stories
    if (nodeData.layer >= 4 && issue.id) {
        const prs = await fetchDevInfo(apiContext, issue.id);
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

    // Crawl linked issues
    for (const nextKey of toCrawl) {
        await crawl(apiContext, nextKey, depth + 1);
    }
}

// ===== OUTPUT =====

function buildOutput(startKey) {
    const nodes = Array.from(visited.values());
    const nodeIds = new Set(nodes.map(n => n.id));
    const uniqueLinks = [];
    const linkSet = new Set();

    for (const link of links) {
        const key = `${link.source}|${link.target}`;
        const reverseKey = `${link.target}|${link.source}`;

        if (linkSet.has(key) || linkSet.has(reverseKey)) continue;
        if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) continue;

        const srcNode = nodes.find(n => n.id === link.source);
        const tgtNode = nodes.find(n => n.id === link.target);

        if (!srcNode || !tgtNode) continue;

        if (srcNode.layer < tgtNode.layer) {
            linkSet.add(key);
            uniqueLinks.push(link);
        } else if (srcNode.layer > tgtNode.layer) {
            linkSet.add(reverseKey);
            uniqueLinks.push({ source: link.target, target: link.source, value: link.value });
        }
    }

    return {
        mdsoRef: startKey,
        scrapedAt: new Date().toISOString(),
        nodes: nodes,
        links: uniqueLinks
    };
}

// ===== UTILS =====

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== RUN =====
main().catch(err => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    process.exit(1);
});
