# Insighta Labs Profile API

Backend Wizards Stage 2 API for storing demographic profiles, filtering them, sorting them, paginating results, and querying profiles with a rule-based natural language parser.

## Stack

- Node.js
- Express
- SQLite via `node:sqlite`
- UUID v7 via `uuid`

## Local setup

```bash
npm install
npm start
```

`npm start` automatically runs the idempotent seed script first, then starts the server.

Default URL:

```text
http://localhost:3000
```

To seed manually:

```bash
npm run seed
```

To seed from a different JSON file:

```bash
node scripts/seed.js /path/to/seed_profiles.json
```

The seed command is safe to run more than once because profile names are unique and inserts use `INSERT OR IGNORE`.

## Data model

The `profiles` table uses this structure:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID v7 | Primary key |
| `name` | VARCHAR + UNIQUE | Person's full name |
| `gender` | VARCHAR | `male` or `female` |
| `gender_probability` | FLOAT | Confidence score |
| `age` | INT | Exact age |
| `age_group` | VARCHAR | `child`, `teenager`, `adult`, `senior` |
| `country_id` | VARCHAR(2) | ISO code |
| `country_name` | VARCHAR | Full country name |
| `country_probability` | FLOAT | Confidence score |
| `created_at` | TIMESTAMP | UTC ISO 8601 timestamp |

Indexes are added for common filters and sort fields: `gender`, `age_group`, `country_id`, `age`, `gender_probability`, `country_probability`, and `created_at`.

## Endpoints

### Create profile

```http
POST /api/profiles
```

Body:

```json
{
  "name": "ella"
}
```

This calls Genderize, Agify, and Nationalize, then stores the profile. Duplicate names return the existing profile instead of creating another row.

### Get one profile

```http
GET /api/profiles/:id
```

### Delete profile

```http
DELETE /api/profiles/:id
```

Returns `204 No Content` on success.

### Get all profiles with filters, sorting, and pagination

```http
GET /api/profiles
```

Supported filters:

- `gender`: `male` or `female`
- `age_group`: `child`, `teenager`, `adult`, or `senior`
- `country_id`: two-letter country code, for example `NG`
- `min_age`: minimum age
- `max_age`: maximum age
- `min_gender_probability`: number from `0` to `1`
- `min_country_probability`: number from `0` to `1`

Sorting:

- `sort_by`: `age`, `created_at`, or `gender_probability`
- `order`: `asc` or `desc`

Pagination:

- `page`: default `1`
- `limit`: default `10`, max `50`

Example:

```bash
curl "http://localhost:3000/api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10"
```

Response shape:

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 2026,
  "data": []
}
```

All filters are combined with `AND`, so a profile must match every condition passed.

## Natural language search

```http
GET /api/profiles/search?q=young males from nigeria
```

Pagination works here too:

```bash
curl "http://localhost:3000/api/profiles/search?q=adult%20males%20from%20kenya&page=1&limit=10"
```

### Parsing approach

The parser is rule-based only. It does not use AI or an LLM. The query is lowercased, punctuation is normalized, then the server checks for supported keywords and maps them to the same filters used by `GET /api/profiles`.

Supported gender keywords:

- `male`, `males`, `man`, `men` -> `gender=male`
- `female`, `females`, `woman`, `women` -> `gender=female`
- If both male and female terms appear, no gender filter is applied. Example: `male and female teenagers above 17` returns both genders.

Supported age keywords:

- `child` or `children` -> `age_group=child`
- `teenager` or `teenagers` -> `age_group=teenager`
- `adult` or `adults` -> `age_group=adult`
- `senior` or `seniors` -> `age_group=senior`
- `young` -> `min_age=16&max_age=24`
- `above 30`, `over 30`, `older than 30`, `at least 30` -> `min_age=30`
- `below 30`, `under 30`, `younger than 30`, `less than 30` -> `max_age=30`
- `between 20 and 30` or `between 20 to 30` -> `min_age=20&max_age=30`

Supported country keywords:

- Country names are matched from the seeded database, for example `nigeria`, `kenya`, `angola`, and `south africa`.
- Common aliases are also supported, for example `usa`, `america`, `uk`, `britain`, `dr congo`, `ivory coast`, and `swaziland`.
- Two-letter country codes after `from` or `in` are supported, for example `from NG`.

Example mappings:

| Query | Filters |
| --- | --- |
| `young males` | `gender=male`, `min_age=16`, `max_age=24` |
| `females above 30` | `gender=female`, `min_age=30` |
| `people from angola` | `country_id=AO` |
| `adult males from kenya` | `gender=male`, `age_group=adult`, `country_id=KE` |
| `male and female teenagers above 17` | `age_group=teenager`, `min_age=17` |

If the parser cannot find any supported filter, it returns:

```json
{
  "status": "error",
  "message": "Unable to interpret query"
}
```

### Parser limitations

- It only understands the documented keywords and simple phrase patterns.
- It does not understand spelling mistakes, slang, complex grammar, or negation like `not from Nigeria`.
- It does not support OR logic, except treating `male and female` as no gender filter.
- It does not infer regions like `West Africa`; use country names or country codes instead.
- It does not parse probability filters from plain English.
- `young` is only a parser shortcut for ages `16` through `24`; it is not stored as an `age_group`.

## Error responses

All errors follow this shape:

```json
{
  "status": "error",
  "message": "<error message>"
}
```

Common errors:

- `400 Bad Request`: missing or empty parameter, invalid query parameters, or unable to interpret query
- `422 Unprocessable Entity`: invalid parameter type
- `404 Not Found`: profile not found
- `502 Bad Gateway`: external API returned invalid data
- `500 Internal Server Error`: unexpected server failure

Invalid query parameters return exactly:

```json
{
  "status": "error",
  "message": "Invalid query parameters"
}
```

## Deployment notes

Recommended start command:

```bash
npm start
```

Because `npm start` runs the seed step first, the deployed SQLite database is populated with the 2026 seed profiles on startup. Re-running the seed does not create duplicates.

## Test commands

```bash
npm test
npm run seed
```
