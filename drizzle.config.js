import { defineConfig } from 'drizzle-kit';

/*
  Local/CI test-database setup only: this extension has no migrations of its own in production. Its
  tables are created the real way, via createTablesFromSchema at install time. This file stands up a
  throwaway database holding kempo's core tables, kempo-products', kempo-inventory's and this
  extension's own.

  No dotenv on purpose: DATABASE_URL must be a real environment variable.
*/
export default defineConfig({
  schema: [
    './server/db/schema.js',
    './node_modules/kempo/server/db/schema.js',
    './node_modules/kempo-products/server/db/schema.js',
    './node_modules/kempo-inventory/server/db/schema.js',
  ],
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
