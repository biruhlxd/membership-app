// Writes prisma/mysql/schema.prisma, the production (MySQL) copy of
// prisma/schema.prisma (SQLite, development). Run after every schema change:
//   npm run db:mysql:schema
// then create the MySQL migration (see README "Hosting").
import { readFileSync, writeFileSync } from "node:fs";

// Fields longer than MySQL's default VARCHAR(191): a session's scope list
// alone is over 300 characters.
const LONG_TEXT = { Session: ["scope", "accessToken", "refreshToken"] };

const source = readFileSync("prisma/schema.prisma", "utf8");
let schema = source.replace(
  /datasource db \{[^}]*\}/,
  'datasource db {\n  provider = "mysql"\n  url      = env("DATABASE_URL")\n}',
);

for (const [model, fields] of Object.entries(LONG_TEXT)) {
  schema = schema.replace(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`), (block) =>
    fields.reduce(
      (b, field) =>
        b.replace(new RegExp(`^(\\s+${field}\\s+String\\??)(.*)$`, "m"), (line, decl, rest) =>
          rest.includes("@db.Text") ? line : `${decl} @db.Text${rest}`,
        ),
      block,
    ),
  );
}

writeFileSync(
  "prisma/mysql/schema.prisma",
  "// GENERATED from prisma/schema.prisma by scripts/mysql-schema.mjs. Do not edit.\n" + schema,
);
console.log("wrote prisma/mysql/schema.prisma");
