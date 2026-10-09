#!/usr/bin/env node
/**
 * Version gate: root package.json "version" must be valid SemVer and match the
 * newest "## <version> - <date>" heading in CHANGELOG.md.
 * Rules: docs/2026-10-09-versioning.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const { version } = JSON.parse(read("package.json"));
const top = read("CHANGELOG.md").match(/^## (\S+) - \d{4}-\d{2}-\d{2}/m)?.[1];

const problems = [];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) problems.push(`package.json version "${version}" is not MAJOR.MINOR.PATCH`);
if (!top) problems.push("CHANGELOG.md has no '## <version> - <YYYY-MM-DD>' heading");
else if (top !== version) problems.push(`package.json is ${version} but the newest CHANGELOG entry is ${top}`);

if (problems.length) {
  console.error(`Version check failed:\n- ${problems.join("\n- ")}\nSee docs/2026-10-09-versioning.md.`);
  process.exit(1);
}
console.log(`Version ${version} matches CHANGELOG.md.`);
