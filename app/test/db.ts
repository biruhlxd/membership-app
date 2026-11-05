// A fresh SQLite database for one test file, built from the app's own
// migrations, and the Prisma client the app's modules will use. Import this
// FIRST in a test file (before any module that imports db.server).
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

const dir = mkdtempSync(join(tmpdir(), "membership-test-"));
const file = join(dir, "test.sqlite");
const sqlite = new DatabaseSync(file);
for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort()) {
  sqlite.exec(readFileSync(join("prisma/migrations", migration, "migration.sql"), "utf8"));
}
sqlite.close();

process.env.DATA_KEY ??= "d".repeat(64);
const client = new PrismaClient({ datasources: { db: { url: `file:${file.replace(/\\/g, "/")}` } } });
(globalThis as { prismaGlobal?: PrismaClient }).prismaGlobal = client;

export const testPrisma = client;

/** A Shopify admin client that answers each query from a function, recording calls. */
export function fakeAdmin(answer: (query: string, variables: Record<string, unknown>) => unknown) {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  return {
    calls,
    admin: {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        const variables = options?.variables ?? {};
        calls.push({ query, variables });
        return new Response(JSON.stringify(answer(query, variables)));
      },
    },
  };
}
