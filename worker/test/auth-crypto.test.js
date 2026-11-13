// Tests for the pure auth crypto helpers (worker/src/auth-crypto.js).
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  b64urlDecode,
  b64urlEncode,
  constantTimeEqual,
  dummyHash,
  generateToken,
  hashPassword,
  parseHash,
  randomBytes,
  resolveIterations,
  sha256Hex,
  verifyPassword,
} from "../src/auth-crypto.js";

const PEPPER = "test-pepper-0123456789abcdef0123456789";
const OPTS = { iterations: 1000 };

describe("sha256Hex", () => {
  it("matches the known vector for 'abc'", async () => {
    assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("base64url", () => {
  it("round-trips lengths 0..40 and never emits +, / or =", () => {
    for (let len = 0; len <= 40; len++) {
      const bytes = randomBytes(len);
      const encoded = b64urlEncode(bytes);
      assert.doesNotMatch(encoded, /[+/=]/);
      assert.deepEqual(b64urlDecode(encoded), bytes, `length ${len}`);
    }
  });
});

describe("generateToken", () => {
  it("has the prefix, 47 chars total, and differs per call", () => {
    const a = generateToken("tts_");
    const b = generateToken("tts_");
    assert.ok(a.startsWith("tts_"));
    assert.equal(a.length, 47);
    assert.notEqual(a, b);
  });
});

describe("constantTimeEqual", () => {
  it("compares byte arrays", () => {
    assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
    assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
    assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
    assert.equal(constantTimeEqual([1, 2, 3], new Uint8Array([1, 2, 3])), false);
  });
});

describe("hashPassword", () => {
  it("produces a four-part pbkdf2-sha256 string with a 16-byte salt and 32-byte hash", async () => {
    const stored = await hashPassword("correct horse battery", PEPPER, OPTS);
    const parts = stored.split("$");
    assert.equal(parts.length, 4);
    assert.equal(parts[0], "pbkdf2-sha256");
    assert.equal(parts[1], "1000");
    assert.equal(b64urlDecode(parts[2]).length, 16);
    assert.equal(b64urlDecode(parts[3]).length, 32);
  });

  it("salts each hash so equal passwords hash differently", async () => {
    const a = await hashPassword("same-password-here", PEPPER, OPTS);
    const b = await hashPassword("same-password-here", PEPPER, OPTS);
    assert.notEqual(a, b);
  });

  it("rejects when the pepper is empty", async () => {
    await assert.rejects(hashPassword("x", "", OPTS));
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and reports no rehash needed", async () => {
    const stored = await hashPassword("correct horse battery", PEPPER, OPTS);
    assert.deepEqual(await verifyPassword("correct horse battery", stored, PEPPER, OPTS), { ok: true, needsRehash: false });
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery", PEPPER, OPTS);
    assert.equal((await verifyPassword("wrong horse battery", stored, PEPPER, OPTS)).ok, false);
  });

  it("rejects with a different pepper", async () => {
    const stored = await hashPassword("correct horse battery", PEPPER, OPTS);
    assert.equal((await verifyPassword("correct horse battery", stored, "another-pepper-0123456789abcdef0123", OPTS)).ok, false);
  });

  it("rejects with an empty pepper", async () => {
    const stored = await hashPassword("correct horse battery", PEPPER, OPTS);
    assert.equal((await verifyPassword("correct horse battery", stored, "", OPTS)).ok, false);
  });

  it("rejects a garbage stored string", async () => {
    assert.equal((await verifyPassword("anything", "not-a-hash", PEPPER, OPTS)).ok, false);
  });

  it("reports needsRehash when stored iterations differ from the wanted count", async () => {
    const stored = await hashPassword("correct horse battery", PEPPER, { iterations: 1000 });
    assert.deepEqual(
      await verifyPassword("correct horse battery", stored, PEPPER, { iterations: 2000 }),
      { ok: true, needsRehash: true }
    );
  });
});

describe("resolveIterations", () => {
  it("clamps AUTH_PBKDF2_ITERATIONS to [1000, 100000] with a 100000 default", () => {
    assert.equal(resolveIterations({}), 100000);
    assert.equal(resolveIterations({ AUTH_PBKDF2_ITERATIONS: "5" }), 1000);
    assert.equal(resolveIterations({ AUTH_PBKDF2_ITERATIONS: "999999" }), 100000);
    assert.equal(resolveIterations({ AUTH_PBKDF2_ITERATIONS: "50000" }), 50000);
    assert.equal(resolveIterations({ AUTH_PBKDF2_ITERATIONS: "abc" }), 100000);
  });
});

describe("dummyHash", () => {
  it("parses as a valid hash and never verifies a password", async () => {
    const dummy = dummyHash(1000);
    const parsed = parseHash(dummy);
    assert.ok(parsed);
    assert.equal(parsed.iterations, 1000);
    assert.equal((await verifyPassword("any password at all", dummy, PEPPER, OPTS)).ok, false);
  });
});
