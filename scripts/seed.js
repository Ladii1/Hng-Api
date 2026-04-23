const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { v7: uuidv7 } = require("uuid");
const { initializeDatabase } = require("../app");

const seedPath = process.argv[2] || path.join(__dirname, "..", "seed_profiles.json");
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "profiles.db");

function readProfiles(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.profiles)) return payload.profiles;
  throw new Error("Seed file must contain a profiles array");
}

const profiles = readProfiles(seedPath);
const db = new DatabaseSync(dbPath);
initializeDatabase(db);

const insert = db.prepare(`
  INSERT OR IGNORE INTO profiles (
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
`);

const now = new Date().toISOString();
function seedRows(rows) {
  db.exec("BEGIN");
  try {
  for (const profile of rows) {
    insert.run(
      profile.id || uuidv7(),
      profile.name,
      String(profile.gender).toLowerCase(),
      profile.gender_probability,
      profile.age,
      String(profile.age_group).toLowerCase(),
      String(profile.country_id).toUpperCase(),
      profile.country_name,
      profile.country_probability,
      profile.created_at || now
    );
  }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const before = db.prepare("SELECT COUNT(*) AS count FROM profiles").get().count;
seedRows(profiles);
const after = db.prepare("SELECT COUNT(*) AS count FROM profiles").get().count;
db.close();

console.log(`Seed complete. Inserted ${after - before} new profiles. Total profiles: ${after}.`);
