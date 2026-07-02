#!/usr/bin/env node
/**
 * Manual Import Helper — Full Hierarchy
 * 
 * Builds the full traceability chain without hitting rate limits.
 * Uses your browser to grab JSON responses (you're already logged in).
 * 
 * USAGE:
 *   Step 1: Save the MDSO project issue:
 *     URL: https://jira.mdsol.com/rest/api/2/issue/MDSO-25672?fields=summary,issuetype,status,issuelinks,customfield_10404
 *     Save as: input/mdso-25672.json
 * 
 *   Step 2: Save the child issues (stories/tasks under the directly linked epics):
 *     URL: https://jira.mdsol.com/rest/api/2/search?jql=parent in (EPIC-1,EPIC-2,...) OR "Epic Link" in (EPIC-1,EPIC-2,...)&fields=key,summary,issuetype,status,issuelinks&maxResults=500
 *     Save as: input/mdso-25672-children.json
 *
 *   Step 3: Run:
 *     node manual-import.js MDSO-25672
 * 
 *   The script will print the exact URLs you need to open.
 */

const fs = require('fs');
const path = require('path');

const JIRA_BASE = 'https://jira.mdsol.com';
const EPIC_LINK_FIELD = 'customfield_10404';

const issueKey = process.argv[2];
if (!issueKey) {
    console.error('Usage: node manual-import.js <MDSO-KEY>');
    console.error('  e.g. node manual-import.js MDSO-25672');
    process.exit(1);
}

const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');
fs.mkdirSync(inputDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const mainFile = path.join(inputDir, `${issueKey.toLowerCase()}.json`);
const childrenFile = path.join(inputDir, `${issueKey.toLowerCase()}-children.json`);

// ===== STEP 1: Check for main issue file =====
if (!fs.existsSync(mainFile)) {
    console.log(`\n📋 Step 1: Save the MDSO project issue\n`);
    console.log(`   Open this URL in your browser:\n`);
    console.log(`   ${JIRA_BASE}/rest/api/2/issue/${issueKey}?fields=summary,issuetype,status,issuelinks,${EPIC_LINK_FIELD}\n`);
    console.log(`   Save the response as:\n   ${mainFile}\n`);
    process.exit(0);
}

console.log(`\n🔗 Manual Import — ${issueKey}\n`);

// Parse main issue
const issue = JSON.parse(fs.readFileSync(mainFile, 'utf8'));
const fields = issue.fields;

const nodes = [];
const links = [];
const nodeIds = new Set();

function addNode(node) {
    if (!nodeIds.has(node.id)) {
        nodeIds.add(node.id);
        nodes.push(node);
    }
}

// Starting project node
const startId = issue.key.toLowerCase();
addNode({
    id: startId,
    key: issue.key,
    label: `PROJ: ${fields.summary}`,
    layer: 2,
    type: 'Project',
    source: 'JIRA',
    status: fields.status?.name || 'Unknown'
});

// Objective from Epic Link
const epicLinkVal = fields[EPIC_LINK_FIELD];
if (epicLinkVal) {
    const objLabel = typeof epicLinkVal === 'string' ? epicLinkVal : (epicLinkVal.name || epicLinkVal.value || JSON.stringify(epicLinkVal));
    addNode({
        id: '__objective__',
        key: 'Objective',
        label: `OBJ: ${objLabel}`,
        layer: 0,
        type: 'Objective',
        source: 'JIRA (Epic Link)',
        status: ''
    });
    links.push({ source: '__objective__', target: startId, value: 1 });
    console.log(`   📎 Objective: ${objLabel}`);
}

// Process issue links from main issue
const directEpics = [];
const issueLinks = fields.issuelinks || [];

for (const link of issueLinks) {
    const linked = link.outwardIssue || link.inwardIssue;
    if (!linked) continue;

    const linkedKey = linked.key;
    const linkedId = linkedKey.toLowerCase();
    const linkedType = linked.fields?.issuetype?.name || 'Unknown';
    const linkedSummary = linked.fields?.summary || linkedKey;
    const linkedStatus = linked.fields?.status?.name || 'Unknown';

    let layer;
    const typeLower = linkedType.toLowerCase();
    if (typeLower.includes('epic') || typeLower.includes('feature')) {
        layer = 3;
        directEpics.push(linkedKey);
    }
    else if (typeLower.includes('release')) layer = 6;
    else if (typeLower.includes('deploy')) layer = 7;
    else if (typeLower.includes('story') || typeLower.includes('task') || typeLower.includes('bug')) layer = 4;
    else layer = 4;

    addNode({
        id: linkedId,
        key: linkedKey,
        label: `${linkedType.toUpperCase().substring(0, 4)}: ${linkedSummary}`,
        layer: layer,
        type: linkedType,
        source: 'JIRA',
        status: linkedStatus
    });
    links.push({ source: startId, target: linkedId, value: 1 });
}

console.log(`   📌 Direct epics: ${directEpics.length} — ${directEpics.join(', ')}`);

// ===== STEP 2: Check for children file =====
if (!fs.existsSync(childrenFile)) {
    const epicList = directEpics.join(',');
    const jql = encodeURIComponent(`parent in (${epicList}) OR "Epic Link" in (${epicList})`);
    console.log(`\n📋 Step 2: Save the child issues (stories/tasks under epics)\n`);
    console.log(`   Open this URL in your browser:\n`);
    console.log(`   ${JIRA_BASE}/rest/api/2/search?jql=${jql}&fields=key,summary,issuetype,status,issuelinks&maxResults=500\n`);
    console.log(`   Save the response as:\n   ${childrenFile}\n`);
    console.log(`   Then re-run: node manual-import.js ${issueKey}\n`);
    process.exit(0);
}

// Parse children
const childData = JSON.parse(fs.readFileSync(childrenFile, 'utf8'));
const childIssues = childData.issues || [];
console.log(`   📦 Child issues loaded: ${childIssues.length}`);

// Process each child issue
for (const child of childIssues) {
    const childKey = child.key;
    const childId = childKey.toLowerCase();
    const childType = child.fields?.issuetype?.name || 'Unknown';
    const childSummary = child.fields?.summary || childKey;
    const childStatus = child.fields?.status?.name || 'Unknown';

    let layer;
    const typeLower = childType.toLowerCase();
    if (typeLower.includes('story')) layer = 4;
    else if (typeLower.includes('task')) layer = 4;
    else if (typeLower.includes('bug')) layer = 4;
    else if (typeLower.includes('release')) layer = 6;
    else if (typeLower.includes('deploy')) layer = 7;
    else layer = 4;

    addNode({
        id: childId,
        key: childKey,
        label: `${childType.toUpperCase().substring(0, 4)}: ${childSummary}`,
        layer: layer,
        type: childType,
        source: 'JIRA',
        status: childStatus
    });

    // Link child to its epic (find which epic it belongs to via parent or Epic Link)
    // Check issuelinks for parent epic
    const childLinks = child.fields?.issuelinks || [];
    let linkedToEpic = false;

    for (const cl of childLinks) {
        const clLinked = cl.inwardIssue || cl.outwardIssue;
        if (!clLinked) continue;
        const clKey = clLinked.key;
        const clType = clLinked.fields?.issuetype?.name || '';

        if (clType.toLowerCase().includes('epic') && directEpics.includes(clKey)) {
            links.push({ source: clKey.toLowerCase(), target: childId, value: 1 });
            linkedToEpic = true;
        }

        // Also capture deployment/release links FROM stories
        const clTypeLower = clType.toLowerCase();
        if (clTypeLower.includes('deploy')) {
            addNode({
                id: clKey.toLowerCase(),
                key: clKey,
                label: `DEPL: ${clLinked.fields?.summary || clKey}`,
                layer: 7,
                type: 'Deployment',
                source: 'JIRA',
                status: clLinked.fields?.status?.name || 'Unknown'
            });
            links.push({ source: childId, target: clKey.toLowerCase(), value: 1 });
        }
        if (clTypeLower.includes('release')) {
            addNode({
                id: clKey.toLowerCase(),
                key: clKey,
                label: `RELE: ${clLinked.fields?.summary || clKey}`,
                layer: 6,
                type: 'Release',
                source: 'JIRA',
                status: clLinked.fields?.status?.name || 'Unknown'
            });
            links.push({ source: childId, target: clKey.toLowerCase(), value: 1 });
        }
        // PR links
        if (clTypeLower.includes('pull') || clType === 'PR') {
            addNode({
                id: clKey.toLowerCase(),
                key: clKey,
                label: `PR: ${clLinked.fields?.summary || clKey}`,
                layer: 5,
                type: 'PR',
                source: 'GitHub',
                status: clLinked.fields?.status?.name || 'Unknown'
            });
            links.push({ source: childId, target: clKey.toLowerCase(), value: 1 });
        }
    }

    // If not linked to epic via issuelinks, try parent field
    if (!linkedToEpic && child.fields?.parent) {
        const parentKey = child.fields.parent.key;
        if (directEpics.includes(parentKey)) {
            links.push({ source: parentKey.toLowerCase(), target: childId, value: 1 });
            linkedToEpic = true;
        }
    }

    // Fallback: link to first epic in the direct list
    if (!linkedToEpic && directEpics.length > 0) {
        // The JQL guarantees this child belongs to one of our epics
        // Try matching by checking if epic is in the JQL results context
        links.push({ source: directEpics[0].toLowerCase(), target: childId, value: 1 });
    }
}

// Deduplicate links
const linkSet = new Set();
const uniqueLinks = links.filter(l => {
    const key = `${l.source}|${l.target}`;
    if (linkSet.has(key)) return false;
    linkSet.add(key);
    return true;
});

// Build output
const output = {
    mdsoRef: issueKey.toUpperCase(),
    scrapedAt: new Date().toISOString(),
    nodes: nodes,
    links: uniqueLinks
};

const outputFile = path.join(outputDir, `traceability-${issueKey.toUpperCase()}-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

console.log(`\n✅ Done!`);
console.log(`   Nodes: ${output.nodes.length}`);
console.log(`   Links: ${uniqueLinks.length}`);
console.log(`   Output: ${outputFile}`);
console.log(`\n   Open index.html and import this JSON to visualize.\n`);
