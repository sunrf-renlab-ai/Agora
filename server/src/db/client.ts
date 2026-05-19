import { promises as dns } from "node:dns";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

// Supabase free tier allows 2 direct + 200 pooler connections.
// `prepare: false` is mandatory when DATABASE_URL points at Supabase's
// transaction-mode pooler — prepared statements fail there because every
// query may land on a different backend.
const isPooler = /pooler\.supabase\.com/.test(connectionString) || /:6543\//.test(connectionString);

// Render's container network is IPv4-only — db.X.supabase.co publishes
// BOTH AAAA + A records, and Bun's default DNS order picks AAAA first
// → ECONNREFUSED. Pre-resolve to the A record and substitute, keeping the
// original hostname in `connection.servername` for TLS SNI verification.
//
// Skip the resolve for literal IPs and localhost — on dev machines running
// Clash/Mihomo with fake-IP DNS hijacking, `dns.resolve4("127.0.0.1")` will
// return something like `198.18.1.151` and break local Postgres.
const url = new URL(connectionString);
const hostname = url.hostname;
const isLiteralOrLoopback =
  hostname === "127.0.0.1" ||
  hostname === "localhost" ||
  hostname === "::1" ||
  /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
if (!isLiteralOrLoopback) {
  try {
    const [first] = await dns.resolve4(hostname);
    if (first) {
      url.hostname = first;
    }
  } catch (err) {
    console.warn("[db] dns.resolve4 failed, using hostname as-is:", err);
  }
}
const finalConnectionString = url.toString();

// Local supabase / docker postgres / CI postgres-alpine all run with SSL off.
// Forcing `ssl: { ... }` against those servers makes postgres-js require an
// SSL handshake that never completes → CONNECT_TIMEOUT and silent test
// breakage. Only require SSL for non-loopback hosts.
const isLocal = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";

export const sqlClient = postgres(finalConnectionString, {
  max: isPooler ? 5 : 10,
  prepare: isPooler ? false : undefined,
  idle_timeout: 30,
  connect_timeout: 10,
  connection: {
    application_name: "agora-server",
  },
  ssl: isLocal ? false : { servername: hostname, rejectUnauthorized: false },
});
export const db = drizzle(sqlClient, { schema });
export type DB = typeof db;
