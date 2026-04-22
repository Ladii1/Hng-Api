const { createApp } = require("./app");

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || "./profiles.db";

const { app } = createApp({ dbPath: DB_PATH });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});