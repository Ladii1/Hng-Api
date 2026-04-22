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

test("GET /api/profiles filters case-insensitively", async () => {
  const server = await createTestServer();

  try {
    await server.request.post("/api/profiles").send({ name: "Ella" });

    const response = await server.request.get("/api/profiles?gender=FEMALE&country_id=ng&age_group=adult");
    assert.equal(response.status, 200);

    const body = response.body;
    assert.equal(body.count, 1);
    assert.deepEqual(Object.keys(body.data[0]), ["id", "name", "gender", "age", "age_group", "country_id"]);
  } finally {
    await server.shutdown();
  }
});

test("POST /api/profiles validates missing and invalid names", async () => {
  const server = await createTestServer();

  try {
    const missingResponse = await server.request.post("/api/profiles").send({});
    assert.equal(missingResponse.status, 400);

    const invalidTypeResponse = await server.request.post("/api/profiles").send({ name: 123 });
    assert.equal(invalidTypeResponse.status, 422);
  } finally {
    await server.shutdown();
  }
});

test("POST /api/profiles returns 502 when Genderize data is invalid", async () => {
  const server = await createTestServer({
    genderize: { gender: null, probability: 0, count: 0 },
  });

  try {
    const response = await server.request.post("/api/profiles").send({ name: "Ella" });

    assert.equal(response.status, 502);
    const body = response.body;
    assert.deepEqual(body, {
      status: "error",
      message: "Genderize returned an invalid response",
    });
  } finally {
    await server.shutdown();
  }
});




