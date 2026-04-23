const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");

const { createApp, insertProfile } = require("./app");

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
  const { app, db, close } = createApp({
    dbPath,
    fetchImpl: createFetchStub(fetchOverrides),
  });

  return {
    db,
    request: request(app),
    async shutdown() {
      close();
      fs.rmSync(dbPath, { force: true });
    },
  };
}

function addProfile(db, overrides = {}) {
  insertProfile(db, {
    id: overrides.id || crypto.randomUUID(),
    name: overrides.name || "Test User",
    gender: overrides.gender || "female",
    gender_probability: overrides.gender_probability ?? 0.9,
    age: overrides.age ?? 28,
    age_group: overrides.age_group || "adult",
    country_id: overrides.country_id || "NG",
    country_name: overrides.country_name || "Nigeria",
    country_probability: overrides.country_probability ?? 0.8,
    created_at: overrides.created_at || "2026-04-01T12:00:00.000Z",
  });
}

test("POST /api/profiles creates and stores a Stage 2 profile", async () => {
  const server = await createTestServer();

  try {
    const response = await server.request.post("/api/profiles").send({ name: "Ella" });

    assert.equal(response.status, 201);
    assert.equal(response.body.status, "success");
    assert.equal(response.body.data.name, "ella");
    assert.equal(response.body.data.age_group, "adult");
    assert.equal(response.body.data.country_id, "NG");
    assert.equal(response.body.data.country_name, "Nigeria");
    assert.equal(response.body.data.sample_size, undefined);
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
    assert.equal(duplicateResponse.body.message, "Profile already exists");
    assert.equal(duplicateResponse.body.data.name, "ella");
  } finally {
    await server.shutdown();
  }
});

test("GET /api/profiles combines filters, sorting, and pagination", async () => {
  const server = await createTestServer();

  try {
    addProfile(server.db, { name: "Ada Okafor", gender: "female", age: 32, country_id: "NG" });
    addProfile(server.db, { name: "Emmanuel Okafor", gender: "male", age: 34, country_id: "NG" });
    addProfile(server.db, { name: "John Mensah", gender: "male", age: 29, country_id: "GH", country_name: "Ghana" });
    addProfile(server.db, { name: "Tunde Bello", gender: "male", age: 45, country_id: "NG" });

    const response = await server.request.get(
      "/api/profiles?gender=male&country_id=ng&min_age=30&sort_by=age&order=desc&page=1&limit=1"
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.page, 1);
    assert.equal(response.body.limit, 1);
    assert.equal(response.body.total, 2);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].name, "Tunde Bello");
  } finally {
    await server.shutdown();
  }
});

test("GET /api/profiles/search parses natural language queries", async () => {
  const server = await createTestServer();

  try {
    addProfile(server.db, { name: "Young Male", gender: "male", age: 22, country_id: "NG" });
    addProfile(server.db, { name: "Older Male", gender: "male", age: 32, country_id: "NG" });
    addProfile(server.db, { name: "Young Female", gender: "female", age: 21, country_id: "NG" });

    const response = await server.request.get("/api/profiles/search?q=young males from nigeria&page=1&limit=10");

    assert.equal(response.status, 200);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.data[0].name, "Young Male");
  } finally {
    await server.shutdown();
  }
});

test("GET /api/profiles/search treats male and female as all genders", async () => {
  const server = await createTestServer();

  try {
    addProfile(server.db, { name: "Male Teen", gender: "male", age: 18, age_group: "teenager", country_id: "KE", country_name: "Kenya" });
    addProfile(server.db, { name: "Female Teen", gender: "female", age: 18, age_group: "teenager", country_id: "KE", country_name: "Kenya" });
    addProfile(server.db, { name: "Young Teen", gender: "male", age: 16, age_group: "teenager", country_id: "KE", country_name: "Kenya" });

    const response = await server.request.get("/api/profiles/search?q=male%20and%20female%20teenagers%20above%2017");

    assert.equal(response.status, 200);
    assert.equal(response.body.total, 2);
  } finally {
    await server.shutdown();
  }
});

test("GET /api/profiles/search returns an error for uninterpretable queries", async () => {
  const server = await createTestServer();

  try {
    const response = await server.request.get("/api/profiles/search?q=banana%20rainbow");

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      status: "error",
      message: "Unable to interpret query",
    });
  } finally {
    await server.shutdown();
  }
});

test("query validation returns the required errors", async () => {
  const server = await createTestServer();

  try {
    const invalidQuery = await server.request.get("/api/profiles?limit=100");
    assert.equal(invalidQuery.status, 400);
    assert.deepEqual(invalidQuery.body, { status: "error", message: "Invalid query parameters" });

    const invalidType = await server.request.get("/api/profiles?gender=male&gender=female");
    assert.equal(invalidType.status, 422);
    assert.deepEqual(invalidType.body, { status: "error", message: "Invalid parameter type" });
  } finally {
    await server.shutdown();
  }
});

test("POST /api/profiles returns 502 when Genderize data is invalid", async () => {
  const server = await createTestServer({ genderize: { gender: null, probability: 0, count: 0 } });

  try {
    const response = await server.request.post("/api/profiles").send({ name: "Ella" });

    assert.equal(response.status, 502);
    assert.deepEqual(response.body, {
      status: "error",
      message: "Genderize returned an invalid response",
    });
  } finally {
    await server.shutdown();
  }
});
