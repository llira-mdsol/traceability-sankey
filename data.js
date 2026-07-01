/**
 * Traceability Data Model & Sample Data
 * 
 * Hierarchy (bottom-up):
 *   PRs (Code Repo) → Stories (JIRA) → Epics (JIRA) / Features (Aha!) → MDSO Projects (JIRA) → Initiatives → Objectives
 * 
 * Each node has:
 *   - id: unique identifier
 *   - label: display name
 *   - layer: which level in the hierarchy (0=Objective, 5=PR)
 *   - type: node category
 *   - source: originating system (JIRA, Aha, GitHub, etc.)
 * 
 * Each link connects a source node to a target node with a value (weight).
 */

// Layer definitions (left to right in Sankey)
const LAYERS = {
    OBJECTIVE: 0,
    INITIATIVE: 1,
    MDSO_PROJECT: 2,
    EPIC_FEATURE: 3,
    STORY: 4,
    PR: 5
};

const LAYER_COLORS = {
    [LAYERS.OBJECTIVE]: 'rgba(229, 115, 115, 0.8)',    // Red
    [LAYERS.INITIATIVE]: 'rgba(255, 183, 77, 0.8)',     // Orange
    [LAYERS.MDSO_PROJECT]: 'rgba(255, 241, 118, 0.8)', // Yellow
    [LAYERS.EPIC_FEATURE]: 'rgba(129, 199, 132, 0.8)', // Green
    [LAYERS.STORY]: 'rgba(79, 195, 247, 0.8)',          // Blue
    [LAYERS.PR]: 'rgba(206, 147, 216, 0.8)'             // Purple
};

const LINK_COLORS = {
    [LAYERS.OBJECTIVE]: 'rgba(229, 115, 115, 0.25)',
    [LAYERS.INITIATIVE]: 'rgba(255, 183, 77, 0.25)',
    [LAYERS.MDSO_PROJECT]: 'rgba(255, 241, 118, 0.25)',
    [LAYERS.EPIC_FEATURE]: 'rgba(129, 199, 132, 0.25)',
    [LAYERS.STORY]: 'rgba(79, 195, 247, 0.25)',
    [LAYERS.PR]: 'rgba(206, 147, 216, 0.25)'
};

/**
 * Sample datasets keyed by MDSO project reference.
 * In production, this would be replaced by API calls to JIRA, Aha!, and your Git provider.
 */
const SAMPLE_DATA = {
    'MDSO-1001': {
        nodes: [
            // Objectives (Layer 0)
            { id: 'obj-1', label: 'OBJ: Improve Platform Reliability', layer: LAYERS.OBJECTIVE, type: 'Objective', source: 'Strategy' },
            { id: 'obj-2', label: 'OBJ: Reduce Operational Cost', layer: LAYERS.OBJECTIVE, type: 'Objective', source: 'Strategy' },

            // Initiatives (Layer 1)
            { id: 'init-1', label: 'INIT: Zero-Downtime Deployments', layer: LAYERS.INITIATIVE, type: 'Initiative', source: 'JIRA' },
            { id: 'init-2', label: 'INIT: Automated Scaling', layer: LAYERS.INITIATIVE, type: 'Initiative', source: 'JIRA' },

            // MDSO Projects (Layer 2)
            { id: 'mdso-1001', label: 'MDSO-1001: Service Mesh Migration', layer: LAYERS.MDSO_PROJECT, type: 'MDSO Project', source: 'JIRA' },

            // Epics / Features (Layer 3)
            { id: 'epic-101', label: 'EPIC: Istio Sidecar Injection', layer: LAYERS.EPIC_FEATURE, type: 'Epic', source: 'JIRA' },
            { id: 'epic-102', label: 'EPIC: Traffic Management Rules', layer: LAYERS.EPIC_FEATURE, type: 'Epic', source: 'JIRA' },
            { id: 'feat-201', label: 'FEAT: Canary Deployment Support', layer: LAYERS.EPIC_FEATURE, type: 'Feature', source: 'Aha!' },
            { id: 'feat-202', label: 'FEAT: Circuit Breaker Config', layer: LAYERS.EPIC_FEATURE, type: 'Feature', source: 'Aha!' },

            // Stories (Layer 4)
            { id: 'story-301', label: 'STORY: Configure sidecar auto-inject', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-302', label: 'STORY: Namespace labeling automation', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-303', label: 'STORY: VirtualService routing rules', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-304', label: 'STORY: DestinationRule policies', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-305', label: 'STORY: Canary weight-based routing', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-306', label: 'STORY: Circuit breaker thresholds', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-307', label: 'STORY: Health check endpoints', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },

            // PRs (Layer 5)
            { id: 'pr-401', label: 'PR #401: Add istio injection labels', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-402', label: 'PR #402: Helm chart sidecar config', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-403', label: 'PR #403: Namespace labeling script', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-404', label: 'PR #404: VirtualService manifests', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-405', label: 'PR #405: DestinationRule YAML', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-406', label: 'PR #406: Canary rollout controller', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-407', label: 'PR #407: Weight adjustment API', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-408', label: 'PR #408: Circuit breaker middleware', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-409', label: 'PR #409: Health check handler', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-410', label: 'PR #410: Retry policy config', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
        ],
        links: [
            // Objectives → Initiatives
            { source: 'obj-1', target: 'init-1', value: 5 },
            { source: 'obj-1', target: 'init-2', value: 3 },
            { source: 'obj-2', target: 'init-2', value: 4 },

            // Initiatives → MDSO Projects
            { source: 'init-1', target: 'mdso-1001', value: 5 },
            { source: 'init-2', target: 'mdso-1001', value: 3 },

            // MDSO Projects → Epics/Features
            { source: 'mdso-1001', target: 'epic-101', value: 3 },
            { source: 'mdso-1001', target: 'epic-102', value: 3 },
            { source: 'mdso-1001', target: 'feat-201', value: 3 },
            { source: 'mdso-1001', target: 'feat-202', value: 2 },

            // Epics/Features → Stories
            { source: 'epic-101', target: 'story-301', value: 2 },
            { source: 'epic-101', target: 'story-302', value: 1 },
            { source: 'epic-102', target: 'story-303', value: 2 },
            { source: 'epic-102', target: 'story-304', value: 1 },
            { source: 'feat-201', target: 'story-305', value: 2 },
            { source: 'feat-201', target: 'story-307', value: 1 },
            { source: 'feat-202', target: 'story-306', value: 1 },
            { source: 'feat-202', target: 'story-307', value: 1 },

            // Stories → PRs
            { source: 'story-301', target: 'pr-401', value: 1 },
            { source: 'story-301', target: 'pr-402', value: 1 },
            { source: 'story-302', target: 'pr-403', value: 1 },
            { source: 'story-303', target: 'pr-404', value: 1 },
            { source: 'story-304', target: 'pr-405', value: 1 },
            { source: 'story-305', target: 'pr-406', value: 1 },
            { source: 'story-305', target: 'pr-407', value: 1 },
            { source: 'story-306', target: 'pr-408', value: 1 },
            { source: 'story-306', target: 'pr-410', value: 1 },
            { source: 'story-307', target: 'pr-409', value: 1 },
        ]
    },

    'MDSO-2002': {
        nodes: [
            // Objectives
            { id: 'obj-3', label: 'OBJ: Accelerate Time-to-Market', layer: LAYERS.OBJECTIVE, type: 'Objective', source: 'Strategy' },

            // Initiatives
            { id: 'init-3', label: 'INIT: CI/CD Pipeline Modernization', layer: LAYERS.INITIATIVE, type: 'Initiative', source: 'JIRA' },

            // MDSO Projects
            { id: 'mdso-2002', label: 'MDSO-2002: Pipeline as Code', layer: LAYERS.MDSO_PROJECT, type: 'MDSO Project', source: 'JIRA' },

            // Epics / Features
            { id: 'epic-201', label: 'EPIC: GitHub Actions Migration', layer: LAYERS.EPIC_FEATURE, type: 'Epic', source: 'JIRA' },
            { id: 'feat-301', label: 'FEAT: Reusable Workflow Library', layer: LAYERS.EPIC_FEATURE, type: 'Feature', source: 'Aha!' },
            { id: 'epic-202', label: 'EPIC: Artifact Management', layer: LAYERS.EPIC_FEATURE, type: 'Epic', source: 'JIRA' },

            // Stories
            { id: 'story-401', label: 'STORY: Convert Jenkins to GHA', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-402', label: 'STORY: Matrix build strategy', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-403', label: 'STORY: Shared action templates', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-404', label: 'STORY: Docker layer caching', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },
            { id: 'story-405', label: 'STORY: SBOM generation', layer: LAYERS.STORY, type: 'Story', source: 'JIRA' },

            // PRs
            { id: 'pr-501', label: 'PR #501: GHA workflow files', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-502', label: 'PR #502: Matrix config', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-503', label: 'PR #503: Composite action lib', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-504', label: 'PR #504: Docker buildx cache', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-505', label: 'PR #505: Syft SBOM step', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
            { id: 'pr-506', label: 'PR #506: Attestation signing', layer: LAYERS.PR, type: 'PR', source: 'GitHub' },
        ],
        links: [
            { source: 'obj-3', target: 'init-3', value: 5 },
            { source: 'init-3', target: 'mdso-2002', value: 5 },
            { source: 'mdso-2002', target: 'epic-201', value: 3 },
            { source: 'mdso-2002', target: 'feat-301', value: 2 },
            { source: 'mdso-2002', target: 'epic-202', value: 2 },
            { source: 'epic-201', target: 'story-401', value: 2 },
            { source: 'epic-201', target: 'story-402', value: 1 },
            { source: 'feat-301', target: 'story-403', value: 2 },
            { source: 'epic-202', target: 'story-404', value: 1 },
            { source: 'epic-202', target: 'story-405', value: 1 },
            { source: 'story-401', target: 'pr-501', value: 1 },
            { source: 'story-402', target: 'pr-502', value: 1 },
            { source: 'story-403', target: 'pr-503', value: 1 },
            { source: 'story-404', target: 'pr-504', value: 1 },
            { source: 'story-405', target: 'pr-505', value: 1 },
            { source: 'story-405', target: 'pr-506', value: 1 },
        ]
    }
};

/**
 * Fetch traceability data for an MDSO project reference.
 * 
 * In production, replace this with real API calls:
 *   1. Query JIRA for the MDSO project → get linked Initiatives & Objectives (upward)
 *   2. Query JIRA for the MDSO project → get linked Epics (downward)
 *   3. Query Aha! for linked Features
 *   4. For each Epic/Feature → get Stories from JIRA
 *   5. For each Story → get linked PRs from GitHub/Bitbucket
 * 
 * @param {string} mdsoRef - The MDSO project reference (e.g., "MDSO-1001")
 * @returns {Promise<{nodes: Array, links: Array} | null>}
 */
async function fetchTraceabilityData(mdsoRef) {
    // Normalize input
    const ref = mdsoRef.trim().toUpperCase();

    // --- SAMPLE DATA MODE ---
    if (SAMPLE_DATA[ref]) {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));
        return SAMPLE_DATA[ref];
    }

    // --- PRODUCTION MODE (uncomment and configure) ---
    // return await fetchFromAPIs(ref);

    return null;
}

/**
 * Production API integration stub.
 * Uncomment and configure with your actual endpoints and auth tokens.
 */
// async function fetchFromAPIs(mdsoRef) {
//     const JIRA_BASE = 'https://your-org.atlassian.net/rest/api/3';
//     const JIRA_TOKEN = 'Bearer YOUR_JIRA_API_TOKEN';
//     const AHA_BASE = 'https://your-org.aha.io/api/v1';
//     const AHA_TOKEN = 'Bearer YOUR_AHA_API_TOKEN';
//     const GITHUB_BASE = 'https://api.github.com';
//     const GITHUB_TOKEN = 'Bearer YOUR_GITHUB_TOKEN';
//
//     const headers = (token) => ({ 'Authorization': token, 'Content-Type': 'application/json' });
//
//     // Step 1: Get MDSO Project issue and its links
//     const mdsoIssue = await fetch(`${JIRA_BASE}/issue/${mdsoRef}?expand=issuelinks`, {
//         headers: headers(JIRA_TOKEN)
//     }).then(r => r.json());
//
//     // Step 2: Traverse links upward (Initiatives, Objectives)
//     // Step 3: Traverse links downward (Epics)
//     // Step 4: Query Aha! for features linked to this project
//     // Step 5: For each epic/feature, get child stories
//     // Step 6: For each story, query GitHub PRs that reference it
//
//     // Build and return { nodes, links } structure
//     return { nodes: [...], links: [...] };
// }
