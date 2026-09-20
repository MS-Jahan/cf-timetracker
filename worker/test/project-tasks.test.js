// Tests for project tasks (default seeding, add/unlink) and listEntries paging.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addProjectTask, createProject, listEntries, removeProjectTask } from "../src/core.js";

const CUSTOMER_ID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "p0000000-0000-4000-8000-000000000001";

/**
 * D1 stub with just enough behavior for the task functions: activities and
 * project_tasks live in in-memory maps, and time_entries returns canned pages.
 */
function stubDb({ activities = [], projectTasks = [], entryRows = [], total = 0 } = {}) {
  const activityRows = activities.map((activity, index) => ({ id: activity.id ?? `a-${index}`, name: activity.name, archived_at: null, ...activity }));
  const links = [...projectTasks];
  const state = { activities: activityRows, links };

  return {
    state,
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          if (/FROM activities WHERE lower\(name\)/.test(sql)) {
            const name = String(this.args[0]).toLowerCase();
            return state.activities.find((a) => a.name.toLowerCase() === name) || null;
          }
          if (/INSERT INTO activities/.test(sql)) return null;
          if (/FROM activities WHERE id = \? AND archived_at IS NULL/.test(sql)) {
            return state.activities.find((a) => a.id === this.args[0]) || null;
          }
          if (/SELECT \* FROM activities WHERE id = \?/.test(sql)) {
            return state.activities.find((a) => a.id === this.args[0]) || null;
          }
          if (/SELECT id FROM customers WHERE id = \?/.test(sql)) return { id: this.args[0] };
          if (/SELECT id FROM projects WHERE id = \?/.test(sql)) return { id: this.args[0] };
          if (/SELECT \* FROM projects WHERE id = \?/.test(sql)) return { id: this.args[0] };
          if (/SELECT COUNT\(\*\) AS total FROM time_entries/.test(sql)) return { total };
          return null;
        },
        async all() {
          if (/FROM project_tasks pt/.test(sql)) {
            const projectId = sql.includes("WHERE pt.project_id = ?") ? this.args[0] : null;
            const rows = state.links
              .filter((link) => projectId === null || link.project_id === projectId)
              .map((link) => ({ ...link, name: state.activities.find((a) => a.id === link.activity_id)?.name ?? "?" }));
            return { results: rows };
          }
          if (/FROM time_entries te/.test(sql)) {
            const limit = this.args[this.args.length - 2];
            return { results: entryRows.slice(0, limit) };
          }
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO activities/.test(sql)) {
            state.activities.push({ id: this.args[0], name: this.args[1], archived_at: null });
          }
          if (/INSERT INTO projects \(/.test(sql)) return { meta: { changes: 1 } };
          if (/INSERT INTO project_tasks/.test(sql)) {
            const [, projectId, activityId, isDefault = 1] = this.args;
            if (state.links.some((link) => link.project_id === projectId && link.activity_id === activityId)) {
              throw new Error("UNIQUE constraint failed: project_tasks.project_id, project_tasks.activity_id");
            }
            state.links.push({ id: this.args[0], project_id: projectId, activity_id: activityId, is_default: isDefault });
          }
          if (/DELETE FROM project_tasks/.test(sql)) {
            const before = state.links.length;
            state.links = state.links.filter((link) => !(link.id === this.args[0] && link.project_id === this.args[1]));
            return { meta: { changes: before - state.links.length } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

describe("createProject default tasks", () => {
  it("seeds General and Meeting links by default", async () => {
    const env = { DB: stubDb() };
    const result = await createProject(env, { customerId: CUSTOMER_ID, name: "New site" });

    assert.equal(result.status, "ok");
    assert.deepEqual(result.tasks.map((t) => t.name).sort(), ["General", "Meeting"]);
    assert.equal(env.DB.state.links.length, 2);
    assert.ok(env.DB.state.links.every((link) => link.is_default === 1));
  });

  it("honors a custom defaultTasks list and skips duplicate names", async () => {
    const env = { DB: stubDb() };
    const result = await createProject(env, {
      customerId: CUSTOMER_ID,
      name: "API build",
      defaultTasks: ["Code review", "code REVIEW", "Deploy"],
    });

    assert.deepEqual(result.tasks.map((t) => t.name), ["Code review", "Deploy"]);
  });

  it("creates no task links when defaultTasks is an empty array", async () => {
    const env = { DB: stubDb() };
    const result = await createProject(env, { customerId: CUSTOMER_ID, name: "Raw", defaultTasks: [] });

    assert.deepEqual(result.tasks, []);
    assert.equal(env.DB.state.links.length, 0);
  });

  it("rejects a non-array defaultTasks", async () => {
    const result = await createProject({ DB: stubDb() }, { customerId: CUSTOMER_ID, name: "X", defaultTasks: "General" });
    assert.equal(result.status, "invalid");
  });
});

describe("addProjectTask / removeProjectTask", () => {
  it("reuses an existing shared activity by name and reports duplicate links", async () => {
    const env = { DB: stubDb({ activities: [{ id: "a-1", name: "Meeting" }] }) };
    const first = await addProjectTask(env, PROJECT_ID, { name: "meeting" });
    assert.equal(first.status, "ok");
    assert.equal(env.DB.state.activities.length, 1, "must not create a second Meeting");

    const duplicate = await addProjectTask(env, PROJECT_ID, { name: "Meeting" });
    assert.equal(duplicate.status, "conflict");
  });

  it("creates the shared activity when the name is new", async () => {
    const env = { DB: stubDb() };
    const result = await addProjectTask(env, PROJECT_ID, { name: "Onboarding" });
    assert.equal(result.status, "ok");
    assert.equal(result.task.name, "Onboarding");
  });

  it("unlinks without deleting the shared activity", async () => {
    const env = { DB: stubDb() };
    const added = await addProjectTask(env, PROJECT_ID, { name: "QA pass" });
    const removed = await removeProjectTask(env, PROJECT_ID, added.task.id);

    assert.equal(removed.status, "ok");
    assert.equal(env.DB.state.activities.length, 1, "activity must survive the unlink");
    const missing = await removeProjectTask(env, PROJECT_ID, added.task.id);
    assert.equal(missing.status, "not_found");
  });
});

describe("listEntries", () => {
  it("rejects a half-open range", async () => {
    const result = await listEntries({ DB: stubDb() }, { fromMs: 1 });
    assert.equal(result.status, "invalid");
  });

  it("applies the range, caps the limit, and reports totals", async () => {
    const env = { DB: stubDb({ entryRows: [{ id: "e1" }, { id: "e2" }], total: 9 }) };
    const result = await listEntries(env, { fromMs: 1000, toMs: 2000, limit: 500 });

    assert.equal(result.status, "ok");
    assert.equal(result.paging.limit, 200, "limit must be capped at 200");
    assert.equal(result.entries.length, 2);
    assert.equal(result.paging.total, 9);
    const [count] = env.DB.state.links;
    void count;
  });
});
