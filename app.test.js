const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");

const { createApp } = require("./app");

function createFetchStub(overrides = {}) {
  return async function fetchStub(url) {
    if (url.startsWith("https://api.genderize.io")) {
      return {
        ok: true,
        async json() {
          return overrides.genderize || { gender: "female", probability: 0.99, count: 1234 };
        },
      };
    }

    if (url.startsWith("https://api.agify.io")) {
      return {
        ok: true,
        async json() {
          return overrides.agify || { age: 46, count: 1000 };
        },
      };
    }

    if (url.startsWith("https://api.nationalize.io")) {
      return {
        ok: true,
        async json() {
          return (
            overrides.nationalize || {
              country: [
                { country_id: "US", probability: 0.25 },
                { country_id: "NG", probability: 0.85 },
              ],
            }
          );
        },
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
}

async function createTestServer(fetchOverrides = {}) {
  const dbPath = path.join(os.tmpdir(), `profiles-${Date.now()}-${Math.random()}.db`);
  const { app, close } = createApp({
    dbPath,
    fetchImpl: createFetchStub(fetchOverrides),
  });

  return {
    request: request(app),
    async shutdown() {
      close();
      fs.rmSync(dbPath, { force: true });
    },
  };
}

test("POST /api/profiles creates and stores a profile", async () => {
  const server = await createTestServer();

  try {
    const response = await server.request.post("/api/profiles").send({ name: "Ella" });

    assert.equal(response.status, 201);

    const body = response.body;
    assert.equal(body.status, "success");
    assert.equal(body.data.name, "ella");
    assert.equal(body.data.age_group, "adult");
    assert.equal(body.data.country_id, "NG");
  } finally {
    await server.shutdown();
  }
});

test("POST /api/profiles is idempotent for duplicate names", async () => {
  const server = await createTestServer();

  try {
    await server.request.post("/api/profiles").send({ name: "Ella" });

    const duplicateResponse = await server.request.post("/api/profiles").send({ name: "ELLA" });

    assert.equal(duplicateResponse.status, 200);
    const body = duplicateResponse.body;
    assert.equal(body.message, "Profile already exists");
    assert.equal(body.data.name, "ella");
  } finally {
    await server.shutdown();
  }
});





