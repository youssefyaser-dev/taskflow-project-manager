import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const port = Number(process.env.PORT || 3000);
const db = openDb(process.env.DB_FILE || 'taskflow.db');
const secret = process.env.TOKEN_SECRET || 'dev-secret-change-me';
if (process.env.SEED_DEMO === '1') seed(db);
createApp(db, { secret }).listen(port, () => console.log(`TaskFlow running on http://localhost:${port}`));
