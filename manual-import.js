#!/usr/bin/env node
/**
 * Manual Import Helper
 * 
 * When rate limited, you can grab data directly from your browser:
 * 
 * 1. Open in browser (you're already logged in):
 *    https://jira.mdsol.com/rest/api/2/issue/MDSO-25672?fields=summary,issuetype,status,issuelinks,customfield_10404
 * 
 * 2. Save the JSON response to a file:
 *    Save as: input/mdso-25672.json
 * 
 * 3. Run this script:
 *    node manual-import.js MDSO-25672
 * 
 * It will parse the issue links and build the traceability structure
 * from the single JSON response (no API calls needed).
 */

const fs = require('fs');
const path = require('path');

const issueKey = process.argv[2];
if (!issueKey) {
    console.error('Usage: node manual-import.js <MDSO-KEY>');
    console.error('');
    console.error('Steps:');
    console.error('  1. Open in your browser:');
    console.error('     https://jira.mdsol.com/rest/api/2/issue/MDSO-25672?fields=summary,issuetype,status,issuelinks,customfield_10404');
    console.error('');
    console.error('  2. Save response as: input/<key>.json');
    console.error('');
    console.error('  3. Run: node manual-import.js MDSO-25672');
    process.exit(1);
}

const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');
fs.mkdirSync(inputDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const inputFile = path.join(inputDir, `${issueKey.toLowerCase()}.json`);
if (!fs.existsSync(inputFile)) {
    console.error(`\n❌ File not found: ${inputFile}`);
    console.error(`\nOpen this URL in your browser and save the response:\n`);
    console.error(`  https://jira.mdsol.com/rest/api/2/issue/${issueKey}?fields=summary,issuetype,status,issuelinks,customfield_10404\n`);
    console.error(`Save as: ${inputFile}\n`);
    process.exit(1);
}

console.log(`\n🔗 Manual Import — ${issueKey}`);
console.log(`   Reading: ${inputFile}\n`);

const issue = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const fields = issue.fields;

const nodes = [];
const links = [];

// Process the starting project
const startId = issue.key.toLowerCase();
nodes.push({
    id: startId,
    key: issue.key,
    label: `PROJ: ${fields.summary}`,
    layer: 2,
    type: 'Project',
    source: 'JIRA',
    status: fields.status?.name || 'Unknown'
});

// Extract Objective from Epic Link (customfield_10404)
const epicLink = fields.customfield_10404;
if (epicLink) {
    const objLabel = typeof epicLink === 'string' ? epicLink : (epicLink.name || epicLink.value || JSON.stringify(epicLink));
    nodes.push({
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

// Process issue links
const issueLinks = fields.issuelinks || [];
let epicCount = 0, releaseCount = 0, deployCount = 0, otherCount = 0;

for (const link of issueLinks) {
    const linked = link.outwardIssue || link.inwardIssue;
    if (!linked) continue;

    const linkedKey = linked.key;
    const linkedId = linkedKey.toLowerCase();
    const linkedType = linked.fields?.issuetype?.name || 'Unknown';
    const linkedSummary = linked.fields?.summary || linkedKey;
    const linkedStatus = linked.fields?.status?.name || 'Unknown';
    const linkDirection = link.outwardIssue ? 'outward' : 'inward';
    const linkTypeName = link.type?.name || '';

    let layer;
    const typeLower = linkedType.toLowerCase();
    if (typeLower.includes('epic') || typeLower.includes('feature')) { layer = 3; epicCount++; }
    else if (typeLower.includes('release')) { layer = 6; releaseCount++; }
    else if (typeLower.includes('deploy')) { layer = 7; deployCount++; }
    else if (typeLower.includes('story') || typeLower.includes('task') || typeLower.includes('bug')) { layer = 4; otherCount++; }
    else { layer = 4; otherCount++; }

    nodes.push({
        id: linkedId,
        key: linkedKey,
        label: `${linkedType.toUpperCase().substring(0, 4)}: ${linkedSummary}`,
        layer: layer,
        type: linkedType,
        source: 'JIRA',
        status: linkedStatus,
        linkType: linkTypeName
    });

    // Link from project to linked issue
    links.push({ source: startId, target: linkedId, value: 1 });
}

console.log(`\n   📌 Directly linked items:`);
console.log(`      Epics: ${epicCount}`);
console.log(`      Releases: ${releaseCount}`);
console.log(`      Deployments: ${deployCount}`);
console.log(`      Other: ${otherCount}`);

// Build output
const output = {
    mdsoRef: issueKey.toUpperCase(),
    scrapedAt: new Date().toISOString(),
    nodes: nodes,
    links: links
};

const outputFile = path.join(outputDir, `traceability-${issueKey.toUpperCase()}-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

console.log(`\n✅ Done!`);
console.log(`   Nodes: ${output.nodes.length}`);
console.log(`   Links: ${output.links.length}`);
console.log(`   Output: ${outputFile}\n`);
console.log(`   Open index.html and import this JSON to visualize.\n`);
