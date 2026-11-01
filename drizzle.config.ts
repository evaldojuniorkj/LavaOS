import { defineConfig } from 'drizzle-kit';

// Migrations rodam com a role de DDL (lavaos_owner), nunca com a de runtime.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? '' },
});
