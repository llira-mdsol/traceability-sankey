# MDSO Traceability Sankey Diagram

Interactive Sankey visualization showing the full change traceability chain from code to strategy:

```
Objectives → Initiatives → MDSO Projects → Epics/Features → Stories → PRs
```

Uses **Playwright** to scrape your JIRA Cloud instance using your browser session — no API tokens required.

## Quick Start

```bash
# 1. Install dependencies
npm install
npm run setup   # installs Chromium for Playwright

# 2. Edit scrape.js and set your JIRA URL
#    (or set JIRA_BASE_URL env variable)

# 3. First run — login manually in the browser
npm run login -- MDSO-25672

# 4. Subsequent runs — headless, uses saved session
npm run scrape -- MDSO-25672

# 5. View the diagram
npm run open
#    Then click "Import JSON" and select the file from output/
```

## How It Works

1. **Playwright** launches a real Chromium browser with a persistent session
2. First time: you log in manually (session is saved for future runs)
3. The script calls JIRA's REST API from within the browser context (authenticated via cookies)
4. It recursively crawls issue links, parent/child relationships, and GitHub PR references
5. Outputs a JSON file that the Sankey diagram app consumes

No API tokens. No browser extension restrictions. Just your normal JIRA login.

## CLI Usage

```bash
node scrape.js <MDSO-KEY> [options]

Options:
  --login    Force re-login (clears saved session)
  --headed   Show the browser window (useful for debugging)

Examples:
  node scrape.js MDSO-25672              # headless scrape
  node scrape.js MDSO-25672 --headed     # watch it work
  node scrape.js MDSO-25672 --login      # re-login first

Environment variables:
  JIRA_BASE_URL   Your JIRA Cloud URL (default: https://your-org.atlassian.net)
```

## Output

Scraped data is saved to `output/traceability-MDSO-XXXXX-YYYY-MM-DD.json`.

Load it into the Sankey diagram:
- Open `index.html` in your browser
- Click **Import JSON** → select the output file
- Or click **Paste JSON** if you copied it

## Configuration

Edit the `CONFIG` object at the top of `scrape.js`:

| Setting | Default | Description |
|---------|---------|-------------|
| `jiraBaseUrl` | env or hardcoded | Your JIRA Cloud instance URL |
| `maxDepth` | 6 | How many levels deep to crawl |
| `requestDelay` | 400ms | Delay between API calls (rate limiting) |
| `concurrency` | 2 | Parallel requests |
| `headless` | true | Run without showing browser |
| `layerMapping` | see code | Maps issue type names to hierarchy layers |

### Custom Issue Types

If your JIRA uses custom issue type names, update `layerMapping`:

```javascript
layerMapping: {
    'Strategic Objective': 0,  // your custom name
    'Initiative': 1,
    'MDSO Project': 2,
    'Epic': 3,
    'Feature': 3,
    'Story': 4,
    'Task': 4,
    'Bug': 4,
}
```

## Project Structure

```
scrape.js        — Playwright CLI scraper
index.html       — Sankey diagram UI
sankey.js        — Diagram rendering (Plotly.js)
data.js          — Sample data + data model reference
package.json     — Dependencies and scripts
.auth-session/   — Saved browser session (gitignored)
output/          — Scraped JSON files (gitignored)
```

## Troubleshooting

**"Login required" every time:**
- Run with `--headed` to see what's happening
- Your org may use SSO that requires periodic re-auth

**Rate limited (429 errors):**
- Increase `requestDelay` in CONFIG
- The script auto-retries after 3s on 429

**Missing PRs:**
- PRs are fetched from JIRA's dev panel (requires GitHub-JIRA integration)
- If your repos aren't connected to JIRA, PRs won't appear

**Wrong hierarchy:**
- Adjust `layerMapping` to match your JIRA issue types
- Run with `--headed` and check the console for issue types discovered
