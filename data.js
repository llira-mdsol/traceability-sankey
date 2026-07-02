/**
 * Traceability Data Model & Sample Data
 * 
 * Hierarchy (left to right in Sankey):
 *   Objectives → Initiatives → MDSO Projects → Epics/Features → Stories → PRs → Releases (MDSO) → Deployments (IH)
 * 
 * Each node has:
 *   - id: unique identifier
 *   - label: display name
 *   - layer: which level in the hierarchy (0=Objective, 7=PR)
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
    PR: 5,
    RELEASE: 6,        // MDSO release types
    DEPLOYMENT: 7,     // IH deploy types
};

const LAYER_NAMES = {
    [LAYERS.OBJECTIVE]: 'Objectives',
    [LAYERS.INITIATIVE]: 'Initiatives',
    [LAYERS.MDSO_PROJECT]: 'MDSO Projects',
    [LAYERS.EPIC_FEATURE]: 'Epics / Features',
    [LAYERS.STORY]: 'Stories',
    [LAYERS.PR]: 'PRs',
    [LAYERS.RELEASE]: 'Releases',
    [LAYERS.DEPLOYMENT]: 'Deployments',
};

const LAYER_COLORS = {
    [LAYERS.OBJECTIVE]: '#e57373',      // Red
    [LAYERS.INITIATIVE]: '#ffb74d',     // Orange
    [LAYERS.MDSO_PROJECT]: '#fff176',   // Yellow
    [LAYERS.EPIC_FEATURE]: '#81c784',   // Green
    [LAYERS.STORY]: '#4fc3f7',          // Blue
    [LAYERS.PR]: '#ce93d8',             // Purple
    [LAYERS.RELEASE]: '#dce775',        // Lime
    [LAYERS.DEPLOYMENT]: '#7986cb',     // Indigo
};

const LAYER_COLORS_RGBA = {
    [LAYERS.OBJECTIVE]: 'rgba(229, 115, 115, 0.85)',
    [LAYERS.INITIATIVE]: 'rgba(255, 183, 77, 0.85)',
    [LAYERS.MDSO_PROJECT]: 'rgba(255, 241, 118, 0.85)',
    [LAYERS.EPIC_FEATURE]: 'rgba(129, 199, 132, 0.85)',
    [LAYERS.STORY]: 'rgba(79, 195, 247, 0.85)',
    [LAYERS.PR]: 'rgba(206, 147, 216, 0.85)',
    [LAYERS.RELEASE]: 'rgba(220, 231, 117, 0.85)',
    [LAYERS.DEPLOYMENT]: 'rgba(121, 134, 203, 0.85)',
};

const LINK_COLORS = {
    [LAYERS.OBJECTIVE]: 'rgba(229, 115, 115, 0.2)',
    [LAYERS.INITIATIVE]: 'rgba(255, 183, 77, 0.2)',
    [LAYERS.MDSO_PROJECT]: 'rgba(255, 241, 118, 0.2)',
    [LAYERS.EPIC_FEATURE]: 'rgba(129, 199, 132, 0.2)',
    [LAYERS.STORY]: 'rgba(79, 195, 247, 0.2)',
    [LAYERS.PR]: 'rgba(206, 147, 216, 0.2)',
    [LAYERS.RELEASE]: 'rgba(220, 231, 117, 0.2)',
    [LAYERS.DEPLOYMENT]: 'rgba(121, 134, 203, 0.2)',
};

/**
 * Sample datasets keyed by MDSO project reference.
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

            // Releases (Layer 6) — MDSO release types
            { id: 'rel-100', label: 'REL: Mesh v1.0 - Initial Rollout', layer: LAYERS.RELEASE, type: 'Release', source: 'JIRA (MDSO)' },
            { id: 'rel-101', label: 'REL: Mesh v1.1 - Traffic Mgmt', layer: LAYERS.RELEASE, type: 'Release', source: 'JIRA (MDSO)' },
            { id: 'rel-102', label: 'REL: Mesh v1.2 - Resilience', layer: LAYERS.RELEASE, type: 'Release', source: 'JIRA (MDSO)' },

            // Deployments (Layer 7) — IH deploy types
            { id: 'dep-501', label: 'DEP: IH-Deploy staging-east 03/15', layer: LAYERS.DEPLOYMENT, type: 'Deployment', source: 'JIRA (IH)' },
            { id: 'dep-502', label: 'DEP: IH-Deploy prod-east 03/22', layer: LAYERS.DEPLOYMENT, type: 'Deployment', source: 'JIRA (IH)' },
            { id: 'dep-503', label: 'DEP: IH-Deploy staging-west 04/01', layer: LAYERS.DEPLOYMENT, type: 'Deployment', source: 'JIRA (IH)' },
            { id: 'dep-504', label: 'DEP: IH-Deploy prod-west 04/08', layer: LAYERS.DEPLOYMENT, type: 'Deployment', source: 'JIRA (IH)' },
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

            // PRs → Releases
            { source: 'pr-401', target: 'rel-100', value: 1 },
            { source: 'pr-402', target: 'rel-100', value: 1 },
            { source: 'pr-403', target: 'rel-100', value: 1 },
            { source: 'pr-404', target: 'rel-101', value: 1 },
            { source: 'pr-405', target: 'rel-101', value: 1 },
            { source: 'pr-406', target: 'rel-102', value: 1 },
            { source: 'pr-407', target: 'rel-102', value: 1 },
            { source: 'pr-408', target: 'rel-102', value: 1 },
            { source: 'pr-409', target: 'rel-102', value: 1 },
            { source: 'pr-410', target: 'rel-102', value: 1 },

            // Releases → Deployments
            { source: 'rel-100', target: 'dep-501', value: 3 },
            { source: 'rel-100', target: 'dep-502', value: 3 },
            { source: 'rel-101', target: 'dep-502', value: 2 },
            { source: 'rel-101', target: 'dep-503', value: 2 },
            { source: 'rel-102', target: 'dep-503', value: 3 },
            { source: 'rel-102', target: 'dep-504', value: 5 },
        ]
    },
};

/**
 * Fetch traceability data for an MDSO project reference.
 * @param {string} mdsoRef - The MDSO project reference (e.g., "MDSO-1001")
 * @returns {Promise<{nodes: Array, links: Array} | null>}
 */
async function fetchTraceabilityData(mdsoRef) {
    const ref = mdsoRef.trim().toUpperCase();
    if (SAMPLE_DATA[ref]) {
        await new Promise(resolve => setTimeout(resolve, 300));
        return SAMPLE_DATA[ref];
    }
    return null;
}
