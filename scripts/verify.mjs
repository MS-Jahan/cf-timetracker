#!/usr/bin/env node
/**
 * Project verification gate.
 *
 * Runs:
 *   1. worker unit tests
 *   2. web production build
 *   3. concurrent single-active-timer behavior check
 *
 * The live check uses a temporary Wrangler dev server unless VERIFY_API_BASE
 * points at an already-running API. A caller-supplied API is never stopped.
 *
 * Usage:
 *   node scripts/verify.mjs
 *   VERIFY_API_BASE=http://127.0.0.1:8787 node scripts/verify.mjs
 *   node scripts/verify.mjs --attempts 20
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerDir = resolve(root, "worker");
const webDir = resolve(root, "web");
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

async function waitForApi(base, child) {
  const deadline = Date.now() + 30_000;
  let lastError = "not started";
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Wrangler exited before becoming ready (code ${child.exitCode})`);
    }
    try {
      const response = await fetch(`${base}/api/bootstrap`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${base}/api/bootstrap (${lastError})`);
}

function startWorker(basePort) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawn(command, ["wrangler", "dev", "--local", "--port", String(basePort)], {
    cwd: workerDir,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

let workerProcess = null;
let ownsWorker = false;
let stopping = false;

async function stopWorker() {
  if (!workerProcess || !ownsWorker || stopping) return;
  stopping = true;
  if (workerProcess.exitCode === null) workerProcess.kill("SIGTERM");
  await Promise.race([
    once(workerProcess, "exit"),
    new Promise((resolveStop) => setTimeout(resolveStop, 5_000)),
  ]);
}

async function main() {
  log("worker unit tests");
  await commandFor("npm", ["test"], workerDir);

  log("GAS receiver tests (local harness)");
  await commandFor(process.execPath, ["--test", resolve(root, "gas", "test", "gas-receiver.test.mjs")], root);

  log("web production build");
  await commandFor("npm", ["run", "build"], webDir);

  const base = suppliedBase || localBase;
  if (suppliedBase) {
    console.log(`[verify] using existing API at ${base}`);
  } else {
    if (!existsSync(resolve(workerDir, "node_modules"))) {
      throw new Error("worker/node_modules is missing; run `cd worker && npm install` first");
    }
    workerProcess = startWorker(serverPort);
    ownsWorker = true;
    await waitForApi(base, workerProcess);
    console.log(`[verify] started temporary Wrangler API at ${base}`);
  }

  log(`single-active-timer concurrency check (${attempts} attempts)`);
  await commandFor(process.execPath, [resolve(root, "scripts/check-single-timer.mjs"), base, String(attempts)], root);
}

try {
  await main();
  log("verification gate passed");
} catch (error) {
  console.error(`\n[verify] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stopWorker();
}
