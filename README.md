# Downtime

An OpenAPI-based API endpoint monitoring tool that checks the health of your API endpoints and sends alerts when status changes occur.

## Features

- **OpenAPI Spec Parsing**: Automatically discovers API endpoints from your OpenAPI specification
- **Scheduled Health Checks**: Monitor endpoints at regular intervals
- **Flexible Alerting**: Get notified via console or Slack when endpoints change status
- **Request Throttling**: Control concurrency with configurable request limits
- **State Management**: Track endpoint status changes over time
- **Customizable Status Detection**: Define custom logic for determining endpoint health

## Installation

```bash
npm i -D dowwntime
```

## Quick Start

Create a `dowwntime.config.ts` file in your project root:

```typescript
import { ConsoleAlert, defineConfig } from "dowwntime";

export default defineConfig({
  openapiSpecUrl: "https://example.com/api/openapi.json",
  concurrency: 10,
  timeoutMs: 5000,
  storagePath: "./storage.tmp",
  maxSpaceUsageBytes: 262144 * 0.1,
  alerts: [new ConsoleAlert()],
});
```

Run the health check:

```bash
npx dowwntime
```

## Configuration Options

### `openapiSpecUrl` (required)

The URL or file path to your OpenAPI specification. Can be:

- A remote URL: `https://registry.scalar.com/@scalar/apis/galaxy?format=yaml`
- A local file path: `./openapi.json`

### `alerts` (required)

Array of alert handlers to notify when endpoint status changes. Built-in options:

#### `ConsoleAlert`

Logs status changes to the console.

```typescript
import { ConsoleAlert, defineConfig } from "dowwntime";

export default defineConfig({
  openapiSpecUrl: "...",
  alerts: [new ConsoleAlert()],
});
```

Output example:

```
[ALERT - UP] Path: /api/health is UP (145ms).
[ALERT - DOWN] Path: /api/data is DOWN (5000ms).
[ALERT - DEGRADED] Path: /api/status is DEGRADED (4200ms).
```

#### `SlackAlert`

Sends formatted messages to a Slack channel via a webhook.

```typescript
import { SlackAlert, defineConfig } from "dowwntime";

export default defineConfig({
  openapiSpecUrl: "...",
  alerts: [new SlackAlert("https://hooks.slack.com/services/YOUR/WEBHOOK/URL")],
});
```

Slack messages include:

- **Status indicator**: ✅ (UP), ❌ (DOWN), ⚠️ (DEGRADED)
- **Endpoint path**: The API path that changed status
- **Full URL**: Clickable link to the tested endpoint
- **Response time**: Duration in milliseconds
- **Color coding**: Green for UP, red for DOWN, yellow for DEGRADED

To set up a Slack webhook:

1. Go to your Slack workspace's App Directory
2. Search for "Incoming Webhooks"
3. Click "Add to Slack" and select your target channel
4. Copy the webhook URL
5. Add it to your `dowwntime.config.ts` or pass as an environment variable

### `concurrency` (optional, default: 5)

Maximum number of concurrent requests. Controls how many endpoints are tested simultaneously.

```typescript
concurrency: 10,
```

### `timeoutMs` (optional, default: 5000)

Request timeout in milliseconds. If an endpoint doesn't respond within this time, it's marked as DOWN.

```typescript
timeoutMs: 5000,
```

### `storagePath` (optional, default: "./storage.tmp")

Path where historical state data is stored. Used to detect status changes between runs.

```typescript
storagePath: "./storage.tmp",
```

### `maxSpaceUsageBytes` (optional, default: 262144 \* 0.95)

Maximum storage size in bytes. Older entries are removed when this limit is exceeded.

```typescript
maxSpaceUsageBytes: 262144 * 0.1,
```

### `baseUrl` (optional)

Override the base URL from the OpenAPI spec. Useful for testing different environments.

```typescript
baseUrl: "https://staging.example.com",
```

### `getExampleValue` (optional)

Provide custom example values for path and query parameters. Useful when parameters don't have defaults in the spec.

```typescript
getExampleValue: (paramName: string, path: string) => {
  if (paramName === "userId") {
    return "12345";
  }
  return undefined;
};
```

### `getStatus` (optional)

Define custom logic for determining endpoint health based on status code and response time.

```typescript
getStatus: (statusCode: number, path: string, durationMs: number) => {
  if (statusCode >= 200 && statusCode < 300) {
    if (path === "/api/health" && durationMs > 1000) {
      return "degraded";
    }
    return "up";
  }
  if (statusCode === 429) {
    // Rate limit - mark as degraded instead of down
    return "degraded";
  }
  return "down";
};
```

## Usage in GitHub Actions

Use the provided workflow to automatically check your API endpoints on a schedule.

### Setup: Create an Orphan Branch

An orphan branch keeps monitoring history separate from your main codebase:

```bash
# Create a new orphan branch (contains no history)
git checkout --orphan dowwntime

# Clear the working directory
git rm -rf .

# Create a minimal .gitkeep file
touch .gitkeep
git add .gitkeep

# Commit the orphan branch
git commit -m "Initial commit"

# Push to remote
git push origin dowwntime

# Switch back to main
git checkout main
```

The orphan branch will contain the `storage.tmp` file with monitoring history and the monitoring results, keeping your main branch clean.

### Workflow Configuration

Create `.github/workflows/dowwntime.yml` in your repository:

```yaml
name: Dowwntime check

on:
  schedule:
    - cron: "*/5 * * * *" # Every 5 minutes
  workflow_dispatch: # Manual trigger
  push:
    branches:
      - main
    paths:
      - ".github/workflows/dowwntime.yml"

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  dowwntime-check:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          ref: dowwntime # Check out the orphan branch

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Create minimal package.json
        run: echo '{"name":"dowwntime","version":"1.0.0","type":"module"}' > package.json

      - name: Install dependencies
        run: npm install dowwntime@latest

      - name: Retrieve config from main branch
        run: |
          git fetch origin main
          git checkout origin/main -- dowwntime.config.ts
          git reset HEAD dowwntime.config.ts

      - name: Run downtime check
        id: result
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }} # If using Slack alerts
        run: npx dowwntime

      - name: Commit results
        run: |
          git add storage.tmp
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git commit -m "chore: Dowwntime check result at $(date -u +"%Y-%m-%dT%H:%M:%SZ")" || echo "No changes to commit"
          git push origin HEAD:dowwntime
```

### How It Works

1. **Schedule**: The workflow runs every 5 minutes (configurable via cron syntax)
2. **Config Fetch**: Pulls the latest `dowwntime.config.ts` from your main branch
3. **Health Check**: Runs monitoring against all endpoints
4. **Results Storage**: Saves results to `storage.tmp` (history is maintained on the orphan branch)
5. **Alerts**: Sends notifications to configured alert handlers (e.g., Slack)
6. **Status Tracking**: Commits results to the orphan branch for historical tracking

### Using Environment Variables

For sensitive data like Slack webhook URLs, use GitHub Secrets:

1. Go to Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add `SLACK_WEBHOOK_URL` with your webhook URL

Update your config to use the secret:

```typescript
import { SlackAlert, defineConfig } from "dowwntime";

export default defineConfig({
  openapiSpecUrl: "...",
  alerts: [new SlackAlert(process.env.SLACK_WEBHOOK_URL!)],
});
```

## License

MIT
