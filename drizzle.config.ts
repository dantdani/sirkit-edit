import { defineConfig } from "drizzle-kit";
import { loadEnvLocal } from "./app/lib/load-env-local";

loadEnvLocal();

export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // [B16.1B §F] the `project_members` RLS policy targets Supabase's built-in
  // `authenticated` role; declare the provider so drizzle-kit never tries to
  // create or manage the platform roles it merely references.
  entities: { roles: { provider: "supabase" } },
});
