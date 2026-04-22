# Backend Wizards Stage 1

A small Express API that:

- accepts a name
- calls Genderize, Agify, and Nationalize
- classifies the result
- stores it in SQLite
- exposes CRUD-style profile endpoints

## Stack

- Node.js
- Express
- SQLite via `node:sqlite`
- UUID v7 via `uuid`

## Run locally

```bash
npm install
npm start
```

The server starts on `http://localhost:3000` by default.

You can change the port with:

```bash
PORT=4000 npm start
```

## API

### Create profile

`POST /api/profiles`

Body:

```json
{
  "name": "ella"
}
```

### Get one profile

`GET /api/profiles/:id`

### Get all profiles

`GET /api/profiles`

Optional query params:

- `gender`
- `country_id`
- `age_group`

Example:

```bash
curl "http://localhost:3000/api/profiles?gender=male&country_id=NG"
```

### Delete profile

`DELETE /api/profiles/:id`

## Notes

- Duplicate names are handled idempotently using a normalized lowercase name.
- Timestamps are stored in UTC ISO 8601 format.
- The API sends `Access-Control-Allow-Origin: *`.
- Invalid upstream data returns `502`.
- Data is stored in `profiles.db`.

## Quick test with curl

```bash
curl -X POST http://localhost:3000/api/profiles \
  -H "Content-Type: application/json" \
  -d '{"name":"ella"}'
```

## Deployment

This app is ready to deploy on platforms like Railway, Heroku, AWS, or Vercel server environments that support Node.js.