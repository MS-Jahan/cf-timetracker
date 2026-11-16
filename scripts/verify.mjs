#!/usr/bin/env node
/**
 * Project verification gate.
 *
 * Runs:
 *   0. version consistency (package.json vs CHANGELOG.md)
 *   1. worker unit tests
 *   2. GAS receiver tests (local harness)
 *   3. web production build
 *   4. concurrent single-active-timer behavior check (authenticated)
 *
 * When it owns the API (default), it starts a throwaway Wrangler dev server on a
 * temporary local D1 (schema + seed applied into a temp dir, removed afterwards),
 * creates or logs in the verify user with a Bearer API token, and runs the live
 * check with that token. A caller-supplied API (VERIFY_API_BASE) is never stopped.
 *
 * Usage:
 *   node scripts/verify.mjs
 *   VERIFY_API_BASE=http://127.0.0.1:8787 VERIFY_TOKEN=ttp_... node scripts/verify.mjs
 *   VERIFY_API_BASE=http://127.0.0.1:8787 VERIFY_USERNAME=verify VERIFY_PASSWORD=... node scripts/verify.mjs
 *   node scripts/verify.mjs --attempts 20
 *
 * Environment (optional):
 *   VERIFY_API_BASE   use an already-running API instead of starting one
 *   VERIFY_TOKEN      session or full-scope API token for VERIFY_API_BASE
 *   VERIFY_USERNAME / VERIFY_PASSWORD  login alternative for VERIFY_API_BASE
 *   VERIFY_API_PORT   port for the owned Wrangler server (default: a free port)
 *   worker/.dev.vars  AUTH_PEPPER / SETUP_TOKEN are read from here when present
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Test-only constants for the throwaway local database. They are not secrets and
// must never be used against a deployed Worker.
const VERIFY_PEPPER_DEFAULT = "verify-local-pepper-not-a-secret-0123456789";
const VERIFY_SETUP_DEFAULT = "verify-local-setup-token-0123456789";
const VERIFY_USER = { username: "verify", password: "verify-local-password-1234" };

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerDir = resolve(root, "worker");
const webDir = resolve(root, "web");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const attemptsIndex = process.argv.indexOf("--attempts");
const attempts = attemptsIndex >= 0 ? Number(process.argv[attemptsIndex + 1]) : 20;
const suppliedBase = process.env.VERIFY_API_BASE?.replace(/\/$/, "");
const serverPort = process.env.VERIFY_API_PORT ? Number(process.env.VERIFY_API_PORT) : await freePort();
const localBase = `http://127.0.0.1:${serverPort}`;

if (!Number.isInteger(attempts) || attempts < 2) {
  console.error("Verification gate: --attempts must be an integer >= 2.");
  process.exit(2);
}

function log(message) {
  console.log(`\n[verify] ${message}`);
}

function commandFor(command, args, cwd, extraEnv = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} was terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}`));
      else resolvePromise();
    });
  });
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

/** Parses worker/.dev.vars (KEY=VALUE; blank and # lines skipped; surrounding quotes stripped). */
function readDevVars() {
  const file = resolve(workerDir, ".dev.vars");
  if (!existsSync(file)) return {};
  const vars = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    vars[line.slice(0, eq).trim()] = value;
  }
  return vars;
}

async function waitForApi(base, child) {
  const deadline = Date.now() + 30_000;
  let lastError = "not started";
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Wrangler exited before becoming ready (code ${child.exitCode})`);
    }
    try {
      const response = await fetch(`${base}/api/auth/status`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${base}/api/auth/status (${lastError})`);
}

function startWorker(port, persistDir, secrets) {
  return spawn(
    npx,
    [
      "wrangler", "dev", "--local",
      "--port", String(port),
      "--persist-to", persistDir,
      "--var", `AUTH_PEPPER:${secrets.pepper}`,
      "--var", `SETUP_TOKEN:${secrets.setupToken}`,
    ],
    {
      cwd: workerDir,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
      stdio: "inherit",
      shell: process.platform === "win32",
      // Own process group so stopWorker() can take down npx -> wrangler -> workerd together.
      detached: process.platform !== "win32",
    }
  );
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json };
}

async function loginToken(base, username, password) {
  const login = await postJson(`${base}/api/auth/login`, { username, password, transport: "token" });
  if (login.status !== 200 || !login.body.token) {
    throw new Error(`login failed (HTTP ${login.status}${login.body.code ? ` ${login.body.code}` : ""})`);
  }
  return login.body.token;
}

/** Owned API: create the verify user on the fresh database, or log in if it already exists. */
async function obtainToken(base, setupToken) {
  const setup = await postJson(`${base}/api/auth/setup`, { setupToken, ...VERIFY_USER, transport: "token" });
  if (setup.status === 201 && setup.body.token) return setup.body.token;
  if (setup.status !== 409) {
    throw new Error(`first-user setup failed (HTTP ${setup.status}${setup.body.code ? ` ${setup.body.code}` : ""})`);
  }
  return loginToken(base, VERIFY_USER.username, VERIFY_USER.password);
}

/** Supplied API: use VERIFY_TOKEN, else log in with VERIFY_USERNAME/VERIFY_PASSWORD. */
async function suppliedToken(base) {
  if (process.env.VERIFY_TOKEN) return process.env.VERIFY_TOKEN;
  if (process.env.VERIFY_USERNAME && process.env.VERIFY_PASSWORD) {
    return loginToken(base, process.env.VERIFY_USERNAME, process.env.VERIFY_PASSWORD);
  }
  throw new Error("set VERIFY_TOKEN or VERIFY_USERNAME/VERIFY_PASSWORD for VERIFY_API_BASE");
}

let workerProcess = null;
let ownsWorker = false;
let stopping = false;
let persistDir = null;

async function stopWorker() {
  if (!workerProcess || !ownsWorker || stopping) return;
  stopping = true;
  const signalGroup = (signal) => {
    try {
      if (process.platform === "win32") workerProcess.kill(signal);
      else process.kill(-workerProcess.pid, signal); // whole group, not just the npx wrapper
    } catch { /* already gone */ }
  };
  if (workerProcess.exitCode === null) signalGroup("SIGTERM");
  await Promise.race([
    once(workerProcess, "exit"),
    new Promise((resolveStop) => setTimeout(resolveStop, 5_000)),
  ]);
  signalGroup("SIGKILL"); // stragglers (workerd) that ignored SIGTERM; no-op once the group is gone
}

async function main() {
  log("version consistency");
  await commandFor("node", ["scripts/check-version.mjs"], root);

  log("worker unit tests");
  await commandFor("npm", ["test"], workerDir);

  log("GAS receiver tests (local harness)");
  await commandFor(process.execPath, ["--test", resolve(root, "gas", "test", "gas-receiver.test.mjs")], root);

  log("web production build");
  await commandFor("npm", ["run", "build"], webDir);

  const base = suppliedBase || localBase;
  let token;
  if (suppliedBase) {
    console.log(`[verify] using existing API at ${base}`);
    token = await suppliedToken(base);
  } else {
    if (!existsSync(resolve(workerDir, "node_modules"))) {
      throw new Error("worker/node_modules is missing; run `cd worker && npm install` first");
    }
    persistDir = mkdtempSync(join(tmpdir(), "tt-verify-"));
    log("preparing throwaway local D1 (schema + seed)");
    await commandFor(npx, ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", persistDir, "--file=../db/schema.sql", "--yes"], workerDir);
    await commandFor(npx, ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", persistDir, "--file=../db/seed.sql", "--yes"], workerDir);

    const devVars = readDevVars();
    const secrets = {
      pepper: devVars.AUTH_PEPPER ?? VERIFY_PEPPER_DEFAULT,
      setupToken: devVars.SETUP_TOKEN ?? VERIFY_SETUP_DEFAULT,
    };
    workerProcess = startWorker(serverPort, persistDir, secrets);
    ownsWorker = true;
    await waitForApi(base, workerProcess);
    console.log(`[verify] started temporary Wrangler API at ${base}`);
    token = await obtainToken(base, secrets.setupToken);
  }

  log(`single-active-timer concurrency check (${attempts} attempts)`);
  await commandFor(process.execPath, [resolve(root, "scripts/check-single-timer.mjs"), base, String(attempts)], root, {
    TT_TOKEN: token,
  });
}

try {
  await main();
  log("verification gate passed");
} catch (error) {
  console.error(`\n[verify] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stopWorker();
  if (persistDir) rmSync(persistDir, { recursive: true, force: true });
}
