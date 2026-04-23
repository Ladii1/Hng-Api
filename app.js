const express = require("express");
const cors = require("cors");
const { DatabaseSync } = require("node:sqlite");
const { v7: uuidv7 } = require("uuid");

const PROFILE_COLUMNS = [
  "id",
  "name",
  "gender",
  "gender_probability",
  "age",
  "age_group",
  "country_id",
  "country_name",
  "country_probability",
  "created_at",
];

const VALID_FILTERS = new Set([
  "gender",
  "age_group",
  "country_id",
  "min_age",
  "max_age",
  "min_gender_probability",
  "min_country_probability",
  "sort_by",
  "order",
  "page",
  "limit",
]);
const VALID_SEARCH_PARAMS = new Set(["q", "page", "limit"]);
const VALID_GENDERS = new Set(["male", "female"]);
const VALID_AGE_GROUPS = new Set(["child", "teenager", "adult", "senior"]);
const VALID_SORT_FIELDS = new Set(["age", "created_at", "gender_probability"]);
const VALID_ORDERS = new Set(["asc", "desc"]);

const COUNTRY_ALIASES = {
  benin: "BJ",
  nigeria: "NG",
  angola: "AO",
  kenya: "KE",
  ghana: "GH",
  tanzania: "TZ",
  uganda: "UG",
  "south africa": "ZA",
  zambia: "ZM",
  zimbabwe: "ZW",
  "united states": "US",
  america: "US",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  britain: "GB",
  "dr congo": "CD",
  "democratic republic of congo": "CD",
  "democratic republic of the congo": "CD",
  "republic of the congo": "CG",
  congo: "CG",
  cameroon: "CM",
  ethiopia: "ET",
  rwanda: "RW",
  egypt: "EG",
  morocco: "MA",
  sudan: "SD",
  "south sudan": "SS",
  senegal: "SN",
  mali: "ML",
  niger: "NE",
  chad: "TD",
  togo: "TG",
  tunisia: "TN",
  algeria: "DZ",
  libya: "LY",
  madagascar: "MG",
  mozambique: "MZ",
  malawi: "MW",
  namibia: "NA",
  botswana: "BW",
  lesotho: "LS",
  eswatini: "SZ",
  swaziland: "SZ",
  mauritius: "MU",
  seychelles: "SC",
  liberia: "LR",
  "sierra leone": "SL",
  guinea: "GN",
  "guinea bissau": "GW",
  "guinea-bissau": "GW",
  "equatorial guinea": "GQ",
  gambia: "GM",
  gabon: "GA",
  "cape verde": "CV",
  "central african republic": "CF",
  "burkina faso": "BF",
  burundi: "BI",
  djibouti: "DJ",
  eritrea: "ER",
  somalia: "SO",
  comoros: "KM",
  mauritania: "MR",
  "western sahara": "EH",
  "ivory coast": "CI",
  "cote d'ivoire": "CI",
  "cote divoire": "CI",
  australia: "AU",
  brazil: "BR",
  canada: "CA",
  china: "CN",
  france: "FR",
  germany: "DE",
  india: "IN",
  japan: "JP",
};

function createApp(options = {}) {
  const dbPath = options.dbPath || "./profiles.db";
  const fetchImpl = options.fetchImpl || fetch;
  const app = express();
  const db = new DatabaseSync(dbPath);

  initializeDatabase(db);

  app.use(cors({ origin: "*" }));
  app.use(express.json());

  app.post("/api/profiles", async (req, res, next) => {
    try {
      const { name } = req.body ?? {};

      if (name === undefined || (typeof name === "string" && !name.trim())) {
        return errorResponse(res, "Missing or empty name", 400);
      }

      if (typeof name !== "string") {
        return errorResponse(res, "Invalid type", 422);
      }

      const normalizedName = normalizeName(name);
      const existingProfile = findProfileByName(db, normalizedName);
      if (existingProfile) {
        return res.status(200).json({
          status: "success",
          message: "Profile already exists",
          data: existingProfile,
        });
      }

      const profile = await buildProfile(normalizedName, fetchImpl);

      try {
        insertProfile(db, profile);
      } catch (error) {
        if (String(error.code).includes("SQLITE_CONSTRAINT")) {
          const duplicateProfile = findProfileByName(db, normalizedName);
          return res.status(200).json({
            status: "success",
            message: "Profile already exists",
            data: duplicateProfile,
          });
        }

        throw error;
      }

      return res.status(201).json({ status: "success", data: profile });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/profiles/search", (req, res) => {
    const validation = validateSearchQuery(req.query);
    if (!validation.ok) {
      return errorResponse(res, validation.message, validation.statusCode);
    }

    const parsed = parseNaturalLanguageQuery(req.query.q, db);
    if (!parsed.ok) {
      return errorResponse(res, "Unable to interpret query", 400);
    }

    const result = queryProfiles(db, {
      ...parsed.filters,
      page: validation.pagination.page,
      limit: validation.pagination.limit,
      sort_by: "created_at",
      order: "asc",
    });

    return res.json({
      status: "success",
      page: validation.pagination.page,
      limit: validation.pagination.limit,
      total: result.total,
      data: result.data,
    });
  });

  app.get("/api/profiles/:id", (req, res) => {
    const profile = getProfileById(db, req.params.id);

    if (!profile) {
      return errorResponse(res, "Profile not found", 404);
    }

    return res.json({ status: "success", data: profile });
  });

  app.get("/api/profiles", (req, res) => {
    const validation = validateProfilesQuery(req.query);
    if (!validation.ok) {
      return errorResponse(res, validation.message, validation.statusCode);
    }

    const result = queryProfiles(db, validation.filters);

    return res.json({
      status: "success",
      page: validation.filters.page,
      limit: validation.filters.limit,
      total: result.total,
      data: result.data,
    });
  });

  app.delete("/api/profiles/:id", (req, res) => {
    const result = db.prepare("DELETE FROM profiles WHERE id = ?").run(req.params.id);

    if (result.changes === 0) {
      return errorResponse(res, "Profile not found", 404);
    }

    return res.status(204).send();
  });

  app.use((error, req, res, next) => {
    const statusCode = error.statusCode || error.status;
    if (statusCode) {
      return res.status(statusCode).json({
        status: "error",
        message: statusCode === 400 ? "Invalid query parameters" : error.message,
      });
    }

    console.error(error);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  });

  return {
    app,
    db,
    close() {
      db.close();
    },
  };
}

function initializeDatabase(db) {
  const columns = db.prepare("PRAGMA table_info(profiles)").all();
  const hasOldSchema = columns.length > 0 && columns.some((column) => !PROFILE_COLUMNS.includes(column.name));

  if (hasOldSchema) {
    db.exec("DROP TABLE profiles");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      gender TEXT NOT NULL,
      gender_probability REAL NOT NULL,
      age INTEGER NOT NULL,
      age_group TEXT NOT NULL,
      country_id TEXT NOT NULL,
      country_name TEXT NOT NULL,
      country_probability REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_name_lower ON profiles(LOWER(name));
    CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender);
    CREATE INDEX IF NOT EXISTS idx_profiles_age_group ON profiles(age_group);
    CREATE INDEX IF NOT EXISTS idx_profiles_country_id ON profiles(country_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles(age);
    CREATE INDEX IF NOT EXISTS idx_profiles_gender_probability ON profiles(gender_probability);
    CREATE INDEX IF NOT EXISTS idx_profiles_country_probability ON profiles(country_probability);
    CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at);
  `);
}

function errorResponse(res, message, statusCode) {
  return res.status(statusCode).json({ status: "error", message });
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function classifyAgeGroup(age) {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
}

async function fetchJson(url, apiName, fetchImpl) {
  let response;

  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw upstreamError(apiName);
  }

  if (!response.ok) {
    throw upstreamError(apiName);
  }

  return response.json();
}

function upstreamError(apiName) {
  const error = new Error(`${apiName} returned an invalid response`);
  error.statusCode = 502;
  return error;
}

async function buildProfile(name, fetchImpl) {
  const encodedName = encodeURIComponent(name);
  const [genderize, agify, nationalize] = await Promise.all([
    fetchJson(`https://api.genderize.io?name=${encodedName}`, "Genderize", fetchImpl),
    fetchJson(`https://api.agify.io?name=${encodedName}`, "Agify", fetchImpl),
    fetchJson(`https://api.nationalize.io?name=${encodedName}`, "Nationalize", fetchImpl),
  ]);

  if (!genderize.gender || !genderize.count) {
    throw upstreamError("Genderize");
  }

  if (agify.age === null || agify.age === undefined) {
    throw upstreamError("Agify");
  }

  if (!Array.isArray(nationalize.country) || nationalize.country.length === 0) {
    throw upstreamError("Nationalize");
  }

  const topCountry = nationalize.country.reduce((best, current) => {
    return current.probability > best.probability ? current : best;
  });

  return {
    id: uuidv7(),
    name,
    gender: genderize.gender.toLowerCase(),
    gender_probability: genderize.probability,
    age: agify.age,
    age_group: classifyAgeGroup(agify.age),
    country_id: topCountry.country_id.toUpperCase(),
    country_name: countryNameFromCode(topCountry.country_id),
    country_probability: topCountry.probability,
    created_at: new Date().toISOString(),
  };
}

function countryNameFromCode(countryId) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(countryId.toUpperCase()) || countryId.toUpperCase();
  } catch (error) {
    return countryId.toUpperCase();
  }
}

function insertProfile(db, profile) {
  db.prepare(`
    INSERT INTO profiles (
      id,
      name,
      gender,
      gender_probability,
      age,
      age_group,
      country_id,
      country_name,
      country_probability,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile.id,
    profile.name,
    profile.gender,
    profile.gender_probability,
    profile.age,
    profile.age_group,
    profile.country_id,
    profile.country_name,
    profile.country_probability,
    profile.created_at
  );
}

function getProfileById(db, id) {
  return db.prepare(`SELECT ${PROFILE_COLUMNS.join(", ")} FROM profiles WHERE id = ?`).get(id);
}

function findProfileByName(db, normalizedName) {
  return db.prepare(`SELECT ${PROFILE_COLUMNS.join(", ")} FROM profiles WHERE LOWER(name) = ?`).get(normalizedName);
}

function hasArrayValue(query) {
  return Object.values(query).some((value) => Array.isArray(value));
}

function hasUnknownParams(query, allowedParams) {
  return Object.keys(query).some((param) => !allowedParams.has(param));
}

function requireNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function parseInteger(value) {
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function parseNumber(value) {
  if (!/^(0(\.\d+)?|1(\.0+)?|\.\d+)$/.test(value)) return null;
  return Number(value);
}

function parsePagination(query) {
  const page = query.page === undefined ? 1 : parseInteger(query.page);
  const limit = query.limit === undefined ? 10 : parseInteger(query.limit);

  if (!page || !limit || limit > 50) {
    return null;
  }

  return { page, limit };
}

function validateProfilesQuery(query) {
  if (hasArrayValue(query)) {
    return { ok: false, statusCode: 422, message: "Invalid parameter type" };
  }

  if (hasUnknownParams(query, VALID_FILTERS)) {
    return { ok: false, statusCode: 400, message: "Invalid query parameters" };
  }

  for (const [key, value] of Object.entries(query)) {
    if (!requireNonEmptyString(value)) {
      return { ok: false, statusCode: 400, message: "Missing or empty parameter" };
    }
  }

  const pagination = parsePagination(query);
  if (!pagination) {
    return { ok: false, statusCode: 400, message: "Invalid query parameters" };
  }

  const filters = { ...pagination };

  if (query.gender !== undefined) {
    const gender = query.gender.toLowerCase();
    if (!VALID_GENDERS.has(gender)) return invalidQueryParameters();
    filters.gender = gender;
  }

  if (query.age_group !== undefined) {
    const ageGroup = query.age_group.toLowerCase();
    if (!VALID_AGE_GROUPS.has(ageGroup)) return invalidQueryParameters();
    filters.age_group = ageGroup;
  }

  if (query.country_id !== undefined) {
    const countryId = query.country_id.toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryId)) return invalidQueryParameters();
    filters.country_id = countryId;
  }

  for (const key of ["min_age", "max_age"]) {
    if (query[key] !== undefined) {
      const parsed = parseInteger(query[key]);
      if (parsed === null || parsed > 130) return invalidQueryParameters();
      filters[key] = parsed;
    }
  }

  if (filters.min_age !== undefined && filters.max_age !== undefined && filters.min_age > filters.max_age) {
    return invalidQueryParameters();
  }

  for (const key of ["min_gender_probability", "min_country_probability"]) {
    if (query[key] !== undefined) {
      const parsed = parseNumber(query[key]);
      if (parsed === null) return invalidQueryParameters();
      filters[key] = parsed;
    }
  }

  if (query.sort_by !== undefined) {
    if (!VALID_SORT_FIELDS.has(query.sort_by)) return invalidQueryParameters();
    filters.sort_by = query.sort_by;
  } else {
    filters.sort_by = "created_at";
  }

  if (query.order !== undefined) {
    const order = query.order.toLowerCase();
    if (!VALID_ORDERS.has(order)) return invalidQueryParameters();
    filters.order = order;
  } else {
    filters.order = "asc";
  }

  return { ok: true, filters };
}

function validateSearchQuery(query) {
  if (hasArrayValue(query)) {
    return { ok: false, statusCode: 422, message: "Invalid parameter type" };
  }

  if (hasUnknownParams(query, VALID_SEARCH_PARAMS)) {
    return { ok: false, statusCode: 400, message: "Invalid query parameters" };
  }

  if (!requireNonEmptyString(query.q)) {
    return { ok: false, statusCode: 400, message: "Missing or empty parameter" };
  }

  for (const [key, value] of Object.entries(query)) {
    if (!requireNonEmptyString(value)) {
      return { ok: false, statusCode: 400, message: "Missing or empty parameter" };
    }
  }

  const pagination = parsePagination(query);
  if (!pagination) {
    return { ok: false, statusCode: 400, message: "Invalid query parameters" };
  }

  return { ok: true, pagination };
}

function invalidQueryParameters() {
  return { ok: false, statusCode: 400, message: "Invalid query parameters" };
}

function queryProfiles(db, filters) {
  const whereParts = [];
  const params = [];

  if (filters.gender) {
    whereParts.push("gender = ?");
    params.push(filters.gender);
  }

  if (filters.age_group) {
    whereParts.push("age_group = ?");
    params.push(filters.age_group);
  }

  if (filters.country_id) {
    whereParts.push("country_id = ?");
    params.push(filters.country_id);
  }

  if (filters.min_age !== undefined) {
    whereParts.push("age >= ?");
    params.push(filters.min_age);
  }

  if (filters.max_age !== undefined) {
    whereParts.push("age <= ?");
    params.push(filters.max_age);
  }

  if (filters.min_gender_probability !== undefined) {
    whereParts.push("gender_probability >= ?");
    params.push(filters.min_gender_probability);
  }

  if (filters.min_country_probability !== undefined) {
    whereParts.push("country_probability >= ?");
    params.push(filters.min_country_probability);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS count FROM profiles ${whereSql}`).get(...params).count;
  const offset = (filters.page - 1) * filters.limit;
  const sortBy = filters.sort_by || "created_at";
  const order = (filters.order || "asc").toUpperCase();

  const data = db.prepare(`
    SELECT ${PROFILE_COLUMNS.join(", ")}
    FROM profiles
    ${whereSql}
    ORDER BY ${sortBy} ${order}, id ASC
    LIMIT ? OFFSET ?
  `).all(...params, filters.limit, offset);

  return { total, data };
}

function parseNaturalLanguageQuery(rawQuery, db) {
  const query = rawQuery.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
  const filters = {};

  const hasMaleTerm = /\b(male|males|men|man)\b/.test(query);
  const hasFemaleTerm = /\b(female|females|women|woman)\b/.test(query);

  if (hasMaleTerm && !hasFemaleTerm) {
    filters.gender = "male";
  }

  if (hasFemaleTerm && !hasMaleTerm) {
    filters.gender = "female";
  }

  for (const ageGroup of VALID_AGE_GROUPS) {
    const pattern = new RegExp(`\\b${ageGroup}s?\\b`);
    if (pattern.test(query)) {
      filters.age_group = ageGroup;
    }
  }

  if (/\byoung\b/.test(query)) {
    filters.min_age = 16;
    filters.max_age = 24;
  }

  const aboveMatch = query.match(/\b(?:above|over|older than|at least)\s+(\d{1,3})\b/);
  if (aboveMatch) {
    filters.min_age = Number(aboveMatch[1]);
  }

  const belowMatch = query.match(/\b(?:below|under|younger than|less than)\s+(\d{1,3})\b/);
  if (belowMatch) {
    filters.max_age = Number(belowMatch[1]);
  }

  const betweenMatch = query.match(/\bbetween\s+(\d{1,3})\s+(?:and|to)\s+(\d{1,3})\b/);
  if (betweenMatch) {
    filters.min_age = Number(betweenMatch[1]);
    filters.max_age = Number(betweenMatch[2]);
  }

  const countryId = findCountryIdInQuery(query, db);
  if (countryId) {
    filters.country_id = countryId;
  }

  const hasAnyFilter = Object.keys(filters).length > 0;
  const validAgeRange = filters.min_age === undefined || filters.max_age === undefined || filters.min_age <= filters.max_age;
  const hasUsefulWords = /\b(people|profiles|users|from|in|young|male|males|female|females|men|women|child|children|teenager|teenagers|adult|adults|senior|seniors|above|over|under|below|between)\b/.test(query);

  if (!hasAnyFilter || !validAgeRange || !hasUsefulWords) {
    return { ok: false };
  }

  return { ok: true, filters };
}

function findCountryIdInQuery(query, db) {
  const countries = getCountryLookups(db);
  for (const [name, countryId] of countries) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`);
    if (pattern.test(query)) {
      return countryId;
    }
  }

  const codeMatch = query.match(/\bfrom\s+([a-z]{2})\b/) || query.match(/\bin\s+([a-z]{2})\b/);
  if (codeMatch) {
    return codeMatch[1].toUpperCase();
  }

  return null;
}

function getCountryLookups(db) {
  const aliases = Object.entries(COUNTRY_ALIASES);
  const rows = db.prepare("SELECT DISTINCT country_id, country_name FROM profiles").all();
  for (const row of rows) {
    aliases.push([row.country_name.toLowerCase(), row.country_id]);
  }

  aliases.sort((a, b) => b[0].length - a[0].length);
  return aliases;
}

module.exports = {
  createApp,
  initializeDatabase,
  insertProfile,
  parseNaturalLanguageQuery,
  queryProfiles,
};
