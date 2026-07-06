/** Aplica as migrações geradas (drizzle-kit generate) contra DATABASE_URL. */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

await migrate(db, { migrationsFolder: './drizzle' });
await pool.end();
console.log('Migrações aplicadas.');
