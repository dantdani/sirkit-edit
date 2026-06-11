import { defineConfig } from "drizzle-kit";
import { loadEnvLocal } from "./app/lib/load-env-local";

loadEnvLocal();

export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
