const express = require("express");
const cors = require("cors");
const { DatabaseSync } = require("node:sqlite");
const { v7: uuidv7 } = require("uuid");

function createApp(options = {}) {
  const dbPath = options.dbPath || "./profiles.db";
  const fetchImpl = options.fetchImpl || fetch;
  const app = express();
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      gender TEXT NOT NULL,
      gender_probability REAL NOT NULL,
      sample_size INTEGER NOT NULL,
      age INTEGER NOT NULL,
      age_group TEXT NOT NULL,
      country_id TEXT NOT NULL,
      country_probability REAL NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  const insertProfile = db.prepare(`
    INSERT INTO profiles (
      id,
      name,
      normalized_name,
      gender,
      gender_probability,
      sample_size,
      age,
      age_group,
      country_id,
      country_probability,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const selectProfileFields = `
    id,
    name,
    gender,
    gender_probability,
    sample_size,
    age,
    age_group,
    country_id,
    country_probability,
    created_at
  `;

  const selectProfileById = db.prepare(`
    SELECT ${selectProfileFields}
    FROM profiles
    WHERE id = ?
  `);

  const selectProfileByName = db.prepare(`
    SELECT ${selectProfileFields}
    FROM profiles
    WHERE normalized_name = ?
  `);

  const deleteProfileById = db.prepare("DELETE FROM profiles WHERE id = ?");

  app.use(cors({ origin: "*" }));
  app.use(express.json());

  function errorResponse(res, message, statusCode) {
    return res.status(statusCode).json({ status: "error", message });
  }

  function normalizeName(name) {
    return name.trim().toLowerCase();
  }

  function classifyAgeGroup(age) {
    if (age <= 12) {
      return "child";
    }
    if (age <= 19) {
      return "teenager";
    }
    if (age <= 59) {
      return "adult";
    }
    return "senior";
  }

  async function fetchJson(url, apiName) {
    let response;

    try {
      response = await fetchImpl(url);
    } catch (error) {
      const upstreamError = new Error(`${apiName} returned an invalid response`);
      upstreamError.statusCode = 502;
      throw upstreamError;
    }

    if (!response.ok) {
      const upstreamError = new Error(`${apiName} returned an invalid response`);
      upstreamError.statusCode = 502;
      throw upstreamError;
    }

    return response.json();
  }

  async function buildProfile(name) {
    const encodedName = encodeURIComponent(name);
    const [genderize, agify, nationalize] = await Promise.all([
      fetchJson(`https://api.genderize.io?name=${encodedName}`, "Genderize"),
      fetchJson(`https://api.agify.io?name=${encodedName}`, "Agify"),
      fetchJson(`https://api.nationalize.io?name=${encodedName}`, "Nationalize"),
    ]);

    if (!genderize.gender || !genderize.count) {
      const error = new Error("Genderize returned an invalid response");
      error.statusCode = 502;
      throw error;
    }

    if (agify.age === null || agify.age === undefined) {
      const error = new Error("Agify returned an invalid response");
      error.statusCode = 502;
      throw error;
    }

    if (!Array.isArray(nationalize.country) || nationalize.country.length === 0) {
      const error = new Error("Nationalize returned an invalid response");
      error.statusCode = 502;
      throw error;
    }

    const topCountry = nationalize.country.reduce((best, current) => {
      if (current.probability > best.probability) {
        return current;
      }
      return best;
    });

    return {
      id: uuidv7(),
      name,
      gender: genderize.gender,
      gender_probability: genderize.probability,
      sample_size: genderize.count,
      age: agify.age,
      age_group: classifyAgeGroup(agify.age),
      country_id: topCountry.country_id,
      country_probability: topCountry.probability,
      created_at: new Date().toISOString(),
    };
  }

  app.post("/api/profiles", async (req, res, next) => {
    try {
      const { name } = req.body ?? {};

      if (name === undefined) {
        return errorResponse(res, "Missing or empty name", 400);
      }

      if (typeof name !== "string") {
        return errorResponse(res, "Invalid type", 422);
      }

      const normalizedName = normalizeName(name);
      if (!normalizedName) {
        return errorResponse(res, "Missing or empty name", 400);
      }

      const existingProfile = selectProfileByName.get(normalizedName);
      if (existingProfile) {
        return res.status(200).json({
          status: "success",
          message: "Profile already exists",
          data: existingProfile,
        });
      }

      const profile = await buildProfile(normalizedName);

      try {
        insertProfile.run(
          profile.id,
          profile.name,
          normalizedName,
          profile.gender,
          profile.gender_probability,
          profile.sample_size,
          profile.age,
          profile.age_group,
          profile.country_id,
          profile.country_probability,
          profile.created_at
        );
      } catch (error) {
        if (String(error.code).includes("SQLITE_CONSTRAINT")) {
          const duplicateProfile = selectProfileByName.get(normalizedName);
          return res.status(200).json({
            status: "success",
            message: "Profile already exists",
            data: duplicateProfile,
          });
        }

        throw error;
      }

      return res.status(201).json({
        status: "success",
        data: profile,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/profiles/:id", (req, res) => {
    const profile = selectProfileById.get(req.params.id);

    if (!profile) {
      return errorResponse(res, "Profile not found", 404);
    }

    return res.json({
      status: "success",
      data: profile,
    });
  });

  app.get("/api/profiles", (req, res) => {
    const filters = [];
    const params = [];

    if (req.query.gender) {
      filters.push("LOWER(gender) = LOWER(?)");
      params.push(String(req.query.gender));
    }

    if (req.query.country_id) {
      filters.push("LOWER(country_id) = LOWER(?)");
      params.push(String(req.query.country_id));
    }

    if (req.query.age_group) {
      filters.push("LOWER(age_group) = LOWER(?)");
      params.push(String(req.query.age_group));
    }

    const query = `
      SELECT
        id,
        name,
        gender,
        age,
        age_group,
        country_id
      FROM profiles
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY created_at ASC
    `;

    const profiles = db.prepare(query).all(...params);

    return res.json({
      status: "success",
      count: profiles.length,
      data: profiles,
    });
  });

  app.delete("/api/profiles/:id", (req, res) => {
    const result = deleteProfileById.run(req.params.id);

    if (result.changes === 0) {
      return errorResponse(res, "Profile not found", 404);
    }

    return res.status(204).send();
  });

  app.use((error, req, res, next) => {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({
        status: "error",
        message: error.message,
      });
    }

    console.error(error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  });

  return {
    app,
    close() {
      db.close();
    },
  };
}

module.exports = { createApp };