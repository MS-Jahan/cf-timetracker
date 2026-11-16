#!/usr/bin/env node
/**
 * Password reset / first-account helper. Prints SQL only; never runs it.
 *
 *   AUTH_PEPPER=... node scripts/reset-password.mjs <username>           # reset password
 *   AUTH_PEPPER=... node scripts/reset-password.mjs <username> --create  # create account
 *
 * Environment:
 *   AUTH_PEPPER          required, >= 32 chars (same value the Worker secret holds)
 *   NEW_PASSWORD         optional; otherwise you are prompted twice (hidden input)
 *   AUTH_PBKDF2_ITERATIONS  optional, clamped like the Worker (default 100000)
 *
 * stdout: the SQL statement(s) only. stderr: status text. Neither ever contains the
 * password or the pepper. Run the output with:
 *   npx wrangler d1 execute DB [--env demo] --remote --command "<sql>"
 * (Owner action: remote D1 writes are never run from this script.)
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { hashPassword, resolveIterations } from "../worker/src/auth-crypto.js";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 256;

const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};

const args = process.argv.slice(2);
const create = args.includes("--create");
const positional = args.filter((a) => !a.startsWith("--"));
if (positional.length !== 1 || args.some((a) => a.startsWith("--") && a !== "--create")) {
  fail("Usage: AUTH_PEPPER=... node scripts/reset-password.mjs <username> [--create]");
}

const pepper = process.env.AUTH_PEPPER ?? "";
if (pepper.length < 32) fail("AUTH_PEPPER is required and must be at least 32 characters.");

const username = positional[0].trim().toLowerCase();
if (!USERNAME_RE.test(username)) {
  fail("Invalid username: 3-64 chars, a-z, 0-9, dot, dash, underscore; must start with a letter or digit.");
}

/** Hidden prompt: the typed characters are not echoed. */
function askHidden(question) {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolveAnswer(answer);
    });
    muted = true;
  });
}

async function readPassword() {
  if (process.env.NEW_PASSWORD !== undefined) return process.env.NEW_PASSWORD;
  if (!process.stdin.isTTY) fail("Not interactive: set NEW_PASSWORD in the environment.");
  const first = await askHidden("New password: ");
  const second = await askHidden("Repeat new password: ");
  if (first !== second) fail("Passwords do not match. Nothing printed.");
  return first;
}

function checkPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    fail(`Password must be at least ${MIN_PASSWORD} characters. Nothing printed.`);
  }
  if (password.length > MAX_PASSWORD) fail(`Password must be at most ${MAX_PASSWORD} characters. Nothing printed.`);
  if (password.toLowerCase() === username) fail("Password must not equal the username. Nothing printed.");
}

const password = await readPassword();
checkPassword(password);

const iterations = resolveIterations({ AUTH_PBKDF2_ITERATIONS: process.env.AUTH_PBKDF2_ITERATIONS });
const hash = await hashPassword(password, pepper, { iterations });
const now = Date.now();

if (create) {
  console.error(`Creating user "${username}" (SQL below).`);
  console.log(
    `INSERT INTO users (id, username, password_hash, password_changed_at, created_at) VALUES ('${randomUUID()}', '${username}', '${hash}', ${now}, ${now});`
  );
} else {
  console.error(`Resetting password for "${username}" (SQL below). Existing sessions will be revoked.`);
  console.log(
    `UPDATE users SET password_hash = '${hash}', failed_attempts = 0, locked_until = NULL, password_changed_at = ${now} WHERE username = '${username}';`
  );
  console.log(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '${username}');`);
}
