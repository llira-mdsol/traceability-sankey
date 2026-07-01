# MDSO Traceability Sankey Diagram

Visual traceability of change from code PRs all the way up to strategic Objectives, rendered as an interactive Sankey diagram.

## Flow (left → right)

```
Objectives → Initiatives → MDSO Projects → Epics/Features → Stories → PRs
(Strategy)   (JIRA)        (JIRA)          (JIRA + Aha!)    (JIRA)    (GitHub)
```

## Quick Start

```bash
# Open directly in your browser (no server needed)
open index.html

# Or serve locally for development
npx http-server . -p 8080
# Then visit http://localhost:8080
```

Enter an MDSO project reference in the input field and click **Load Traceability**.

### Sample Data Available

| MDSO Ref    | Description                |
|-------------|----------------------------|
| MDSO-1001   | Service Mesh Migration     |
| MDSO-2002   | Pipeline as Code           |

## Architecture

```
index.html  — UI shell with Plotly.js CDN
data.js     — Data model, sample data, and API integration stubs
sankey.js   — Rendering logic and interaction handlers
```

## Connecting to Real APIs

Edit `data.js` and uncomment the `fetchFromAPIs()` function. You'll need:

### 1. JIRA REST API (Epics, Stories, MDSO Projects, Initiatives)

```javascript
// Base: https://your-org.atlassian.net/rest/api/3
// Auth: Basic auth with API token or OAuth 2.0
// Key endpoints:
//   GET /issue/{MDSO-REF}?expand=issuelinks  — get the MDSO project + links
//   GET /search?jql=parent={EPIC-KEY}        — get stories under an epic
//   GET /issue/{KEY}/remotelink               — get linked PRs
```

**Link traversal strategy:**
- From MDSO project, follow `issuelinks` with type "is part of" upward → Initiatives
- From Initiatives, follow links upward → Objectives (or use custom fields)
- From MDSO project, follow links downward → Epics
- From Epics, query child issues → Stories

### 2. Aha! REST API (Features)

```javascript
// Base: https://your-org.aha.io/api/v1
// Auth: Bearer token
// Key endpoints:
//   GET /features?q={search}                  — find features by integration field
//   GET /features/{id}/requirements           — get linked requirements/stories
```

**Integration approach:**
- Use Aha!'s JIRA integration field to correlate Features with JIRA Epics
- Or query by custom field that holds the MDSO project reference

### 3. GitHub REST/GraphQL API (PRs)

```javascript
// REST: https://api.github.com
// Auth: Bearer token (fine-grained PAT)
// Key endpoints:
//   GET /search/issues?q=repo:{owner}/{repo}+is:pr+{STORY-KEY}
//   — searches PR titles/bodies for JIRA story keys
//
// GraphQL alternative for bulk queries:
//   query { search(query: "repo:org/repo is:pr STORY-301", type: ISSUE) { ... } }
```

**PR-to-Story linking approaches:**
1. **Commit message convention**: PRs reference story keys in title/description (e.g., `[STORY-301]`)
2. **JIRA Development panel**: Use JIRA's dev info API if your repos are connected
3. **GitHub-JIRA app**: Query remote links on JIRA issues

### Environment Variables (suggested)

```bash
export JIRA_BASE_URL=https://your-org.atlassian.net
export JIRA_API_TOKEN=your-token
export AHA_API_TOKEN=your-token
export GITHUB_TOKEN=ghp_your-token
```

For a browser-only solution, consider a lightweight proxy/BFF that handles auth and CORS:

```
Browser → Your BFF (Node/Python) → JIRA API
                                  → Aha! API
                                  → GitHub API
```

## Customization

### Adding new MDSO project sample data

Add entries to the `SAMPLE_DATA` object in `data.js`:

```javascript
SAMPLE_DATA['MDSO-3003'] = {
    nodes: [
        { id: 'obj-x', label: 'OBJ: ...', layer: LAYERS.OBJECTIVE, type: 'Objective', source: 'Strategy' },
        // ... more nodes
    ],
    links: [
        { source: 'obj-x', target: 'init-x', value: 3 },
        // ... more links
    ]
};
```

### Adjusting colors

Edit `LAYER_COLORS` and `LINK_COLORS` in `data.js`.

### Changing diagram orientation

In `sankey.js`, change `orientation: 'h'` to `orientation: 'v'` for vertical flow.

## Browser Support

Works in any modern browser (Chrome, Firefox, Safari, Edge). Uses Plotly.js 2.32 from CDN.
