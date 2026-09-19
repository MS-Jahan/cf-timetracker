# System Architecture & Technical Specification — Initial Prompt

> **Source:** Initial architecture prompt supplied by project owner.
> **Saved:** 2026-09-19
> **Status:** Foundational reference — implementation agents may extend schemas, adapt data models (e.g. multi-tenancy, team roles, custom tax), and scale interfaces to domain requirements.
> **Related docs:**
> - `2026-09-19-brainstorm-notes.md` — open questions, approaches, decisions
> - `2026-09-19-phased-plan.md` — phased delivery plan
> - `2026-09-19-task-list.md` — detailed checkable task list

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Pages                         │
│       (Vite + React / Tailwind UI - Kimai Interface)        │
└───────────────┬─────────────────────────────▲───────────────┘
                │ HTTP API Requests           │ Zero Trust Auth
                ▼                             │ (Email PIN / Google)
┌─────────────────────────────────────────────┴───────────────┐
│                   Cloudflare Worker                         │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │   REST API Routes     │       │   MCP Server (SSE /   │  │
│  │ (/api/bootstrap, etc) │       │   JSON-RPC Protocol)  │  │
│  └───────────┬───────────┘       └───────────┬───────────┘  │
└──────────────┼───────────────────────────────┼──────────────┘
               │ D1 Binding                    │ External Webhook
               ▼                               ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│    Cloudflare D1 (SQLite)    │ │ Google Sheets (via Apps    │
│  (Customers, Projects, Logs) │ │ Script Webhook Sync)       │
└──────────────────────────────┘ └────────────────────────────┘
```

---

## 1. Cloudflare D1 Database Schema (`schema.sql`)

D1 runs SQLite at the edge. Run `wrangler d1 execute <DB_NAME> --file=./schema.sql` to initialize:

```sql
-- Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT DEFAULT 'USD',
    hourly_rate REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    budget_type TEXT CHECK(budget_type IN ('hourly', 'fixed')) DEFAULT 'hourly',
    rate REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Activities Table (e.g., Development, Meeting, Design)
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Time Entries Table
CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    description TEXT,
    tags TEXT, -- Comma-separated tags or JSON array string
    start_time INTEGER NOT NULL, -- Unix Epoch timestamp in milliseconds
    end_time INTEGER,            -- Null if timer is currently running
    duration_seconds INTEGER DEFAULT 0,
    rate_applied REAL DEFAULT 0.0,
    cost REAL DEFAULT 0.0,
    is_running INTEGER DEFAULT 0 CHECK(is_running IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (activity_id) REFERENCES activities(id)
);

-- Application Settings Table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Indices for rapid filtering
CREATE INDEX IF NOT EXISTS idx_entries_customer ON time_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_entries_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_entries_start ON time_entries(start_time);
CREATE INDEX IF NOT EXISTS idx_entries_running ON time_entries(is_running);
```

---

## 2. Cloudflare Worker Backend Implementation (`worker.js`)

This worker handles single-trip bootstrapping, state updates, timer controls, and optional Google Sheets forwarding.

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle preflight CORS
    if (request.method === "OPTIONS") {
      return handleCors();
    }

    try {
      // 1. Single-Trip App Bootstrap (Minimizes daily requests)
      if (request.method === "GET" && url.pathname === "/api/bootstrap") {
        const [activeTimer, recentEntries, customers, projects, activities] = await Promise.all([
          env.DB.prepare("SELECT * FROM time_entries WHERE is_running = 1 LIMIT 1").first(),
          env.DB.prepare(`
            SELECT te.*, c.name AS customer_name, c.currency, p.name AS project_name, a.name AS activity_name
            FROM time_entries te
            LEFT JOIN customers c ON te.customer_id = c.id
            LEFT JOIN projects p ON te.project_id = p.id
            LEFT JOIN activities a ON te.activity_id = a.id
            ORDER BY te.start_time DESC LIMIT 50
          `).all(),
          env.DB.prepare("SELECT * FROM customers ORDER BY name ASC").all(),
          env.DB.prepare("SELECT * FROM projects ORDER BY name ASC").all(),
          env.DB.prepare("SELECT * FROM activities ORDER BY name ASC").all()
        ]);

        return jsonResponse({
          activeTimer: activeTimer || null,
          entries: recentEntries.results || [],
          customers: customers.results || [],
          projects: projects.results || [],
          activities: activities.results || []
        });
      }

      // 2. Start Live Timer
      if (request.method === "POST" && url.pathname === "/api/timer/start") {
        const body = await request.json();
        const { customerId, projectId, activityId, description, tags, hourlyRate } = body;

        // Verify no other timer is running
        const existing = await env.DB.prepare("SELECT id FROM time_entries WHERE is_running = 1 LIMIT 1").first();
        if (existing) {
          return jsonResponse({ error: "A timer is already active." }, 400);
        }

        const id = crypto.randomUUID();
        const startTime = Date.now();

        await env.DB.prepare(`
          INSERT INTO time_entries (id, customer_id, project_id, activity_id, description, tags, start_time, rate_applied, is_running)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).bind(id, customerId, projectId, activityId, description || "", tags || "", startTime, hourlyRate || 0.0).run();

        const created = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first();
        return jsonResponse({ success: true, timer: created });
      }

      // 3. Stop Active Timer
      if (request.method === "POST" && url.pathname === "/api/timer/stop") {
        const active = await env.DB.prepare("SELECT * FROM time_entries WHERE is_running = 1 LIMIT 1").first();
        if (!active) {
          return jsonResponse({ error: "No active timer found." }, 404);
        }

        const endTime = Date.now();
        const durationSeconds = Math.max(1, Math.round((endTime - active.start_time) / 1000));
        const cost = (durationSeconds / 3600) * (active.rate_applied || 0);

        await env.DB.prepare(`
          UPDATE time_entries
          SET end_time = ?, duration_seconds = ?, cost = ?, is_running = 0
          WHERE id = ?
        `).bind(endTime, durationSeconds, cost, active.id).run();

        const finalized = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(active.id).first();
        return jsonResponse({ success: true, timer: finalized });
      }

      // 4. Sync Filtered Entries to Google Sheets (via Apps Script Web App)
      if (request.method === "POST" && url.pathname === "/api/sync/google-sheets") {
        const { gasWebhookUrl, filterMonth } = await request.json();
        if (!gasWebhookUrl) {
          return jsonResponse({ error: "Google Apps Script Web App URL is required" }, 400);
        }

        const entries = await env.DB.prepare(`
          SELECT te.id, date(te.start_time / 1000, 'unixepoch') AS log_date,
                 te.start_time, te.end_time, te.duration_seconds,
                 c.name AS customer, p.name AS project, a.name AS activity,
                 te.description, te.tags, te.cost
          FROM time_entries te
          LEFT JOIN customers c ON te.customer_id = c.id
          LEFT JOIN projects p ON te.project_id = p.id
          LEFT JOIN activities a ON te.activity_id = a.id
          WHERE te.is_running = 0
          ORDER BY te.start_time DESC
        `).all();

        // Forward payload to Google Apps Script Web App
        const gasResponse = await fetch(gasWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: entries.results })
        });

        const gasResult = await gasResponse.json();
        return jsonResponse({ success: true, gasResult });
      }

      return jsonResponse({ error: "Route not found" }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cf-Access-Jwt-Assertion"
    }
  });
}

function handleCors() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cf-Access-Jwt-Assertion"
    }
  });
}
```

---

## 3. Google Apps Script Receiver Code (`Code.gs`)

Deploy this as a **Web App** (Execute as: *Me*, Who has access: *Anyone*) to accept records sent from the dashboard:

```javascript
// Handles POST requests dispatched by Cloudflare Worker or Frontend
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const entries = payload.entries; // Array of row objects

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("TimeEntries");
    if (!sheet) {
      sheet = ss.insertSheet("TimeEntries");
      sheet.appendRow([
        "Entry ID", "Date", "Customer", "Project", "Activity",
        "Duration (Hours)", "Cost", "Description", "Tags"
      ]);
    }

    const rows = entries.map(item => [
      item.id,
      item.log_date,
      item.customer,
      item.project,
      item.activity,
      (item.duration_seconds / 3600).toFixed(2),
      item.cost,
      item.description,
      item.tags
    ]);

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success", count: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

---

## 4. Model Context Protocol (MCP) Server Integration

This architecture can serve an MCP server directly on Cloudflare Workers via JSON-RPC 2.0. An AI agent (e.g., Claude Desktop, cursor, or custom assistant) connects to `/mcp` and executes time tracking tasks autonomously.

### Exposed MCP Tools Schema:

1. `get_active_timer`: Checks if work is ongoing and gets the elapsed duration.
2. `start_timer`: Parameters: `customerId`, `projectId`, `activityId`, `description`.
3. `stop_timer`: Halts tracking and tallies final billing.
4. `query_summary`: Summarizes time spent per customer/project across a date range.

```javascript
// MCP JSON-RPC handler snippet inside Worker
async function handleMcpRpc(request, env) {
  const { method, params, id } = await request.json();

  switch (method) {
    case "tools/list":
      return jsonResponse({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "get_active_timer",
              description: "Check if a timer is currently active",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "start_timer",
              description: "Start tracking time on a specific project",
              inputSchema: {
                type: "object",
                properties: {
                  customerId: { type: "string" },
                  projectId: { type: "string" },
                  activityId: { type: "string" },
                  description: { type: "string" }
                },
                required: ["customerId", "projectId", "activityId"]
              }
            },
            {
              name: "stop_timer",
              description: "Stop the active running timer",
              inputSchema: { type: "object", properties: {} }
            }
          ]
        }
      });

    case "tools/call":
      if (params.name === "get_active_timer") {
        const active = await env.DB.prepare("SELECT * FROM time_entries WHERE is_running = 1").first();
        return jsonResponse({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(active || { status: "idle" }) }] }
        });
      }
      // Additional tool handlers...
  }
}
```

---

## 5. Frontend & UI Architecture (Kimai-Style)

### Component Layout Hierarchy

```
┌────────────────────────────────────────────────────────────────────────┐
│ [Logo] Kimai-Lite    [Active Timer: 01:24:12] [Customer ▼] [Project ▼] │
│                      [Activity ▼] [Description...]  [■ Stop / ▶ Start] │
├────────────────────────────────────────────────────────────────────────┤
│ Filters: [Date Range: This Month ▼] [Customer: All ▼] [Project: All ▼] │
│ Actions: [⟳ Refresh] [⬇ Export CSV] [⎙ Print PDF] [☁ Sync Sheets]      │
├────────────────────────────────────────────────────────────────────────┤
│ Date       Customer   Project   Activity   Duration   Rate    Total   │
│ 2026-09-19 Acme Corp  API Dev   Coding     02:30:00   $75.00  $187.50 │
│ 2026-09-19 GlobalTech Audit     Review     00:45:00   $90.00  $67.50  │
└────────────────────────────────────────────────────────────────────────┘
```

### High-Fidelity Print & PDF Stylesheet (`print.css`)

No heavy server-side PDF renderer is required. An optimized `@media print` layout renders clean PDF timesheets directly through the browser print dialog (`window.print()`):

```css
@media print {
  /* Hide non-essential navigation, inputs, and actions */
  header, .tracker-bar, .action-buttons, .filter-controls, button {
    display: none !important;
  }

  body {
    background: #ffffff;
    color: #000000;
    font-size: 11pt;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .print-header {
    display: block !important;
    margin-bottom: 24px;
    border-bottom: 2px solid #333333;
    padding-bottom: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 16px;
  }

  th, td {
    border-bottom: 1px solid #e5e5e5;
    padding: 8px 10px;
    text-align: left;
  }

  th {
    font-weight: 600;
    background-color: #f9f9f9 !important;
    -webkit-print-color-adjust: exact;
  }

  .page-break {
    page-break-inside: avoid;
  }
}
```

---

## 6. Zero Trust Authentication & Access Control

Protect the entire deployment using **Cloudflare Zero Trust Access** (free up to 50 users):

1. In Cloudflare Zero Trust Dashboard, set up an **Access Application** mapped to your Cloudflare Pages domain (e.g., `timesheet.yourdomain.com`).
2. Add an **Access Policy:**
   - **Rule Action:** Allow.
   - **Include:** Emails ending in `@yourcompany.com` or specific personal emails.
   - **Identity Providers:** One-Time PIN (default) or Google OAuth.
3. Every authenticated request transmits the `Cf-Access-Authenticated-User-Email` header to your application, securing your D1 database automatically.

---

## Implementation Notes (added 2026-09-19)

These gaps were noticed while filing this spec and are tracked in the phased plan / task list:

- `filterMonth` is accepted by `/api/sync/google-sheets` but never applied — needs a `WHERE` clause or documented removal.
- Worker has no input validation (missing IDs, FK existence), no auth check, and `Access-Control-Allow-Origin: *` conflicts with Zero Trust intent.
- MCP handler is a snippet only: `stop_timer`, `start_timer`, `query_summary`, error paths, and SSE/Streamable transport are undefined.
- Frontend, `wrangler.toml`, seed data, and CRUD for customers/projects/activities are unspecified and must be designed in Phase 1–4.
- GAS receiver has no dedupe (re-sync appends duplicates), no auth/secret, and no month filtering.
