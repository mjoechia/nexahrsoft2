import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: "require",
  prepare: false,
  // Release idle connections after 60s — PgBouncer closes server connections at 600s
  // (default server_idle_timeout), so this ensures the pool never holds a dead connection.
  idle_timeout: 60,
  // Reconnect up to 5 times before surfacing the error.
  max_lifetime: 1800,
});
export const db = drizzle(client, { schema });
