'use strict';
const app = require('./app');
const db = require('./db');

const port = Number(process.env.PORT || 4000);
db.initSchema()
  .then(() => app.listen(port, () => console.log(`Limkokwing Registration running on http://localhost:${port}`)))
  .catch(err => {
    console.error('Failed to initialise database schema:', err);
    process.exitCode = 1;
  });
