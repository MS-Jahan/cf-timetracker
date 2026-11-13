import { useEffect, useState } from "react";
import {
  createApiToken,
  listApiTokens,
  MCP_URL,
  revokeApiToken,
} from "../lib/api.js";
import Icon from "./Icon.jsx";

const EXPIRY_OPTIONS = [
  { value: "none", label: "No expiry" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

const SCOPE_LABELS = { mcp: "MCP only", full: "Full access" };

function formatDay(ms) {
  return ms ? new Date(ms).toLocaleDateString() : "Never";
}

function formatUsed(ms) {
  return ms ? new Date(ms).toLocaleString() : "Never";
}

/** Shown once after creation. The raw token lives only in this component's state. */
function CreatedToken({ token, onDone }) {
  const [copied, setCopied] = useState(null);
  const addCommand = `claude mcp add --transport http timetracker ${MCP_URL} --header "Authorization: Bearer ${token}"`;
  const mcpJson = `{
  "mcpServers": {
    "timetracker": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer \${TIMETRACKER_MCP_TOKEN}" }
    }
  }
}`;

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied("Copy failed. Select the text and copy it manually.");
    }
  }

  return (
    <div className="card card-border mt-6 bg-base-200">
      <div className="card-body gap-4">
        <div>
          <p className="font-medium">Copy this token now. It will not be shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="figure break-all rounded bg-base-100 px-2 py-1 text-sm">{token}</code>
            <button type="button" className="btn btn-ghost btn-xs ring-1 ring-inset ring-base-300" onClick={() => copy(token, "Token copied.")}>
              <Icon name="save" size={14} />
              Copy token
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          <p className="field-label">Claude Code command</p>
          <pre className="figure overflow-x-auto rounded bg-base-100 p-3 text-xs whitespace-pre-wrap break-all">{addCommand}</pre>
          <button type="button" className="btn btn-ghost btn-xs w-fit ring-1 ring-inset ring-base-300" onClick={() => copy(addCommand, "Command copied.")}>
            Copy command
          </button>
        </div>

        <div className="grid gap-2">
          <p className="field-label">.mcp.json (keeps the token out of the file)</p>
          <p className="ink-muted text-sm">Set the variable first: <code className="figure">export TIMETRACKER_MCP_TOKEN=&lt;token&gt;</code></p>
          <pre className="figure overflow-x-auto rounded bg-base-100 p-3 text-xs">{mcpJson}</pre>
          <button type="button" className="btn btn-ghost btn-xs w-fit ring-1 ring-inset ring-base-300" onClick={() => copy(mcpJson, ".mcp.json copied.")}>
            Copy .mcp.json
          </button>
        </div>

        {copied && <p role="status" className="ink-muted text-sm">{copied}</p>}
        <div>
          <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** Personal API tokens for MCP clients and scripts: list, create (token shown once), revoke. */
export default function ApiTokensPanel() {
  const [tokens, setTokens] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ name: "", scope: "mcp", expiry: "90" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listApiTokens()
      .then((data) => {
        if (!cancelled) setTokens(data.tokens || []);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Give the token a name, for example \"Claude Code laptop\".");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await createApiToken({
        name,
        scope: form.scope,
        expiresInDays: form.expiry === "none" ? null : Number(form.expiry),
      });
      setCreated(data.token);
      setTokens((prev) => [data.apiToken, ...(prev || [])]);
      setForm((prev) => ({ ...prev, name: "" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(token) {
    if (!window.confirm(`Revoke token "${token.name}"? Clients using it stop working immediately.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await revokeApiToken(token.id);
      setTokens((prev) => (prev || []).filter((item) => item.id !== token.id));
      setNotice(`Revoked "${token.name}".`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {loadError && <div role="alert" className="alert alert-error mb-4"><span>{loadError}</span></div>}
      {error && <div role="alert" className="alert alert-error mb-4"><span>{error}</span></div>}
      {notice && <div role="status" className="alert alert-success mb-4"><span>{notice}</span></div>}

      {tokens === null && !loadError ? (
        <p className="ink-muted"><span className="loading loading-spinner loading-sm" /> Loading tokens…</p>
      ) : tokens && tokens.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scope</th>
                <th>Token</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Expires</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  <td className="font-medium">{token.name}</td>
                  <td><span className="badge badge-outline badge-sm">{SCOPE_LABELS[token.scope] || token.scope}</span></td>
                  <td className="figure text-sm">{token.prefix}…</td>
                  <td>{formatDay(token.createdAt)}</td>
                  <td>{formatUsed(token.lastUsedAt)}</td>
                  <td>{formatDay(token.expiresAt)}</td>
                  <td className="text-right">
                    <button type="button" className="btn btn-ghost btn-xs text-accent" disabled={busy} onClick={() => handleRevoke(token)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tokens ? (
        <p className="ink-muted">No API tokens yet.</p>
      ) : null}

      {created ? (
        <CreatedToken token={created} onDone={() => setCreated(null)} />
      ) : (
        <form className="mt-6 grid max-w-xl gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end" onSubmit={handleCreate}>
          <label className="grid gap-1.5">
            <span className="field-label">Token name</span>
            <input
              className="input w-full"
              value={form.name}
              maxLength={80}
              placeholder="Claude Code laptop"
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="field-label">Scope</span>
            <select className="select" value={form.scope} onChange={(e) => setForm((prev) => ({ ...prev, scope: e.target.value }))}>
              <option value="mcp">MCP only</option>
              <option value="full">Full access</option>
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="field-label">Expires</span>
            <select className="select" value={form.expiry} onChange={(e) => setForm((prev) => ({ ...prev, expiry: e.target.value }))}>
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-3">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Icon name="plus" size={16} />
              Create token
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
