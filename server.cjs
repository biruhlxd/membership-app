// Startup file for the cPanel Node.js app (Passenger). Passenger loads it
// with require(), so it is CommonJS. It runs React Router's production server
// (the same as `npm run start`), which listens on the PORT Passenger gives it.
const path = require("node:path");

process.env.NODE_ENV = process.env.NODE_ENV ?? "production";
process.argv = [process.argv[0], "react-router-serve", path.join(__dirname, "build/server/index.js")];

require(path.join(path.dirname(require.resolve("@react-router/serve/package.json")), "bin.js"));
