import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const scriptPath = fileURLToPath(new URL("./lexicon.py", import.meta.url));
const uvBin = process.env.UV_BIN ?? "uv";
const uvPython = process.env.UV_PYTHON ?? "3.12";

const args = [
  "run",
  "--python",
  uvPython,
  "--with",
  "kiwipiepy",
  "python",
  scriptPath,
  "--db",
  config.runtime.dbPath,
  "--channels",
  config.discord.styleChannelIds.join(","),
  "--guilds",
  config.discord.styleGuildIds.join(","),
  "--out",
  config.runtime.lexiconPath,
];

process.stdout.write(`running: ${uvBin} ${args.join(" ")}\n`);
const result = spawnSync(uvBin, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
