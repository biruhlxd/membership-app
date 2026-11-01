// Startup file for the cPanel Node.js app (Passenger). Passenger loads it
// with require(), so it is CommonJS. It runs React Router's production server
// (the same as `npm run start`), which listens on the PORT Passenger gives it.
const fs = require("node:fs");
const path = require("node:path");

// Passenger on the shared host discards normal output, so webhook and
// renewal messages would be lost. With APP_LOG_FILE set, everything the app
// prints is also appended there.
if (process.env.APP_LOG_FILE) {
  const log = fs.createWriteStream(process.env.APP_LOG_FILE, { flags: "a" });
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      log.write(chunk);
      return write(chunk, ...rest);
    };
  }
}

// The server finds its scripts (build/client) relative to the working
// directory, and Passenger starts the app from the subdomain's web folder.
process.chdir(__dirname);

process.env.NODE_ENV = process.env.NODE_ENV ?? "production";

// The shared host caps how many threads the account may run (CloudLinux).
// Prisma's engine would start a thread per CPU core and a connection pool
// sized from them; keep both small. Set before Prisma loads.
process.env.TOKIO_WORKER_THREADS = process.env.TOKIO_WORKER_THREADS ?? "2";
if (process.env.DATABASE_URL && !/[?&]connection_limit=/.test(process.env.DATABASE_URL)) {
  const join = process.env.DATABASE_URL.includes("?") ? "&" : "?";
  process.env.DATABASE_URL += `${join}connection_limit=3`;
}
process.argv = [process.argv[0], "react-router-serve", path.join(__dirname, "build/server/index.js")];

require(path.join(path.dirname(require.resolve("@react-router/serve/package.json")), "bin.js"));
