#!/usr/bin/env node
/**
 * MDSO Traceability Scraper — Playwright CLI
 *
 * Usage:
 *   npx playwright install chromium   # first time only
 *   node scrape.js MDSO-25672         # scrape a specific project
 *   node scrape.js MDSO-25672 --login # force re-login
 *
 * This opens a real browser, uses your saved JIRA session (or prompts login),
 * and crawls the issue link hierarchy via JIRA's REST API from inside the
 * authenticated browser context. No API tokens needed.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ===== CONFIGURATION =====
const CONFIG = {
    // Your JIRA Cloud instance (set via env or edit here)
    jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://jira.mdsol.com',

    // Where to save the browser session between runs
    sessionDir: path.join(__dirname, '.auth-session'),

    // Output directory for scraped JSON
    outputDir: path.join(__dirname, 'output'),

    // Crawl settings
    maxDepth: 6,
    requestDelay: 400, // ms between API calls
    concurrency: 2,

    // Issue type → layer mapping
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
    },

    // REST API version (use 'latest' for auto-detection, '2' for Server/DC, '3' for Cloud)
    apiVersion: '2',

    // Headless mode (set false to watch the browser)
    headless: true,
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
    console.error('  --headed  Show the browser window');
    process.exit(1);
}

if (showBrowser) {
    CONFIG.headless = false;
}

// ===== MAIN =====
async function main() {
    console.log(`\n🔗 Traceability Scraper — ${issueKey}`);
    console.log(`   JIRA: ${CONFIG.jiraBaseUrl}`);
    console.log(`   Session: ${CONFIG.sessionDir}\n`);

    // Clear session if forced
    if (forceLogin && fs.existsSync(CONFIG.sessionDir)) {
        fs.rmSync(CONFIG.sessionDir, { recursive: true });
        console.log('   Cleared saved session.\n');
    }

    // Ensure output dir exists
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });

    // Launch browser with persistent context (saves cookies/localStorage)
    const browser = await chromium.launchPersistentContext(CONFIG.sessionDir, {
        headless: CONFIG.headless,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        args: [
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--js-flags=--max-old-space-size=4096',
        ],
        ignoreHTTPSErrors: true,
        timeout: 60000,
    });

    const page = await browser.newPage();

    // Check if we have a valid session
    const loggedIn = await checkSession(page);
    if (!loggedIn) {
        await doLogin(page);
    }

    console.log('✅ Authenticated. Starting crawl...\n');

    // Crawl the issue hierarchy
    await crawl(page, issueKey.toUpperCase(), 0);

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

    await browser.close();
}

// ===== AUTH =====

async function checkSession(page) {
    try {
        // Navigate to a JIRA page to establish cookie context
        const response = await page.goto(`${CONFIG.jiraBaseUrl}/rest/api/${CONFIG.apiVersion}/myself`, {
            waitUntil: 'commit',
            timeout: 30000
        });

        // If we get redirected to login, session is invalid
        const finalUrl = page.url();
        if (finalUrl.includes('/login') || finalUrl.includes('login.jsp') || finalUrl.includes('os_destination')) {
            return false;
        }

        if (response && response.status() === 200) {
            const body = await page.evaluate(() => document.body?.innerText || '');
            try {
                const user = JSON.parse(body);
                if (user.displayName || user.name) {
                    console.log(`   Logged in as: ${user.displayName || user.name}`);
                    return true;
                }
            } catch {
                // Response wasn't JSON — probably a login page
                return false;
            }
        }
        return false;
    } catch (err) {
        console.log(`   Session check failed: ${err.message}`);
        return false;
    }
}

async function doLogin(page) {
    console.log('🔐 Login required. Opening JIRA login page...');
    console.log('   Please log in manually in the browser window.');
    console.log('   (You have 5 minutes to complete login)\n');

    // Navigate to JIRA — it will redirect to login
    await page.goto(CONFIG.jiraBaseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for the user to complete login
    // Strategy: poll for successful API response instead of URL matching
    console.log('   Waiting for login to complete...');

    const maxWait = 300000; // 5 minutes
    const pollInterval = 3000; // check every 3 seconds
    const startTime = Date.now();
    let loggedIn = false;

    while (Date.now() - startTime < maxWait) {
        await sleep(pollInterval);

        // Try to call the API from whatever page we're on
        const result = await page.evaluate(async ({ baseUrl, apiVer }) => {
            try {
                const resp = await fetch(`${baseUrl}/rest/api/${apiVer}/myself`, {
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' }
                });
                if (resp.ok) {
                    const data = await resp.json();
                    return data.displayName || data.name || null;
                }
                return null;
            } catch {
                return null;
            }
        }, { baseUrl: CONFIG.jiraBaseUrl, apiVer: CONFIG.apiVersion });

        if (result) {
            console.log(`\n   ✅ Logged in as: ${result}`);
            loggedIn = true;
            break;
        }
    }

    if (!loggedIn) {
        throw new Error('Login timed out after 5 minutes. Try again with --login --headed');
    }

    console.log('   Session saved for future runs.\n');
}

// ===== JIRA API (via browser context) =====

async function fetchJSON(page, url) {
    const response = await page.evaluate(async (fetchUrl) => {
        const resp = await fetch(fetchUrl, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });
        if (!resp.ok) {
            return { error: resp.status, statusText: resp.statusText };
        }
        return resp.json();
    }, url);

    return response;
}

async function fetchIssue(page, key) {
    const url = `${CONFIG.jiraBaseUrl}/rest/api/${CONFIG.apiVersion}/issue/${key}?fields=summary,issuetype,status,issuelinks,parent,subtasks,project`;
    const data = await fetchJSON(page, url);

    if (data?.error) {
        if (data.error === 429) {
            // Rate limited — wait and retry
            console.log(`   ⏳ Rate limited, waiting 3s...`);
            await sleep(3000);
            return fetchIssue(page, key);
        }
        if (data.error === 404) return null;
        console.warn(`   ⚠️  Failed to fetch ${key}: ${data.error} ${data.statusText || ''}`);
        return null;
    }

    return data;
}

async function fetchChildIssues(page, parentKey) {
    const jql = encodeURIComponent(`parent = ${parentKey} OR "Epic Link" = ${parentKey}`);
    const url = `${CONFIG.jiraBaseUrl}/rest/api/${CONFIG.apiVersion}/search?jql=${jql}&fields=key,summary,issuetype,status,issuelinks&maxResults=100`;
    const data = await fetchJSON(page, url);

    if (data?.error) {
        if (data.error === 429) {
            await sleep(3000);
            return fetchChildIssues(page, parentKey);
        }
        return [];
    }

    return data?.issues || [];
}

async function fetchDevInfo(page, issueId) {
    const url = `${CONFIG.jiraBaseUrl}/rest/dev-status/latest/issue/detail?issueId=${issueId}&applicationType=GitHub&dataType=pullrequest`;
    const data = await fetchJSON(page, url);

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
    if (lower.includes('mdso') || lower.includes('project')) return 2;
    if (lower.includes('epic') || lower.includes('feature')) return 3;
    if (lower.includes('pr') || lower.includes('pull')) return 5;
    return 4;
}

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

async function crawl(page, key, depth) {
    if (depth > CONFIG.maxDepth) return;
    if (visited.has(key)) return;

    totalRequests++;
    const progress = `[${completedRequests}/${totalRequests}]`;
    const indent = '  '.repeat(Math.min(depth, 4));
    process.stdout.write(`\r   ${progress} ${indent}${key}...`);

    const issue = await fetchIssue(page, key);
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
        const children = await fetchChildIssues(page, key);
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
        const prs = await fetchDevInfo(page, issue.id);
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
        await crawl(page, nextKey, depth + 1);
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
        // Skip same-layer links
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
