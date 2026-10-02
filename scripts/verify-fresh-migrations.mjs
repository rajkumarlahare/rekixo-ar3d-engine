import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const stateDir = path.join(root, ".wrangler", "ci-migration-chain");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const database = "rekixo-3d-production";
const config = "wrangler.infra.jsonc";

fs.rmSync(stateDir, { recursive: true, force: true });
fs.mkdirSync(stateDir, { recursive: true });

function run(args, { capture = false } = {}) {
  const result = spawnSync(npx, ["--no-install", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = capture
      ? `\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
      : "";
    throw new Error(
      `Command failed (${result.status}): ${npx} --no-install ${args.join(" ")}${details}`,
    );
  }
  return result.stdout || "";
}

const localArgs = [
  "--local",
  "--persist-to",
  stateDir,
  "--config",
  config,
];

console.log("Applying the full D1 migration chain to a fresh local database...");
run(["wrangler", "d1", "migrations", "apply", database, ...localArgs]);

console.log("Re-applying migrations to verify the migration ledger is stable...");
run(["wrangler", "d1", "migrations", "apply", database, ...localArgs]);

function executeJson(command) {
  const stdout = run(
    [
      "wrangler",
      "d1",
      "execute",
      database,
      ...localArgs,
      "--command",
      command,
      "--json",
    ],
    { capture: true },
  );
  const payload = JSON.parse(stdout);
  const rows = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.results)) rows.push(...value.results);
    for (const child of Object.values(value)) {
      if (child !== value.results) visit(child);
    }
  };
  visit(payload);
  return rows;
}

const requiredObjects = new Set([
  "projects_3d",
  "studio_drafts_3d",
  "releases_3d",
  "experiences_3d",
  "geo_releases_3d",
  "engine_deletion_jobs_3d",
  "trg_projects_3d_block_insert_during_delete",
]);

const objectRows = executeJson(
  `SELECT name
     FROM sqlite_master
    WHERE type IN ('table','trigger')
      AND name IN (
        'projects_3d',
        'studio_drafts_3d',
        'releases_3d',
        'experiences_3d',
        'geo_releases_3d',
        'engine_deletion_jobs_3d',
        'trg_projects_3d_block_insert_during_delete'
      )
    ORDER BY name`,
);
const found = new Set(objectRows.map((row) => row.name));
const missing = [...requiredObjects].filter((name) => !found.has(name));
if (missing.length)
  throw new Error(`Fresh migration chain is missing required schema objects: ${missing.join(", ")}`);

const migrationFiles = fs
  .readdirSync(path.join(root, "database", "migrations"))
  .filter((name) => /^\d+.*\.sql$/i.test(name))
  .sort();

const ledgerRows = executeJson("SELECT COUNT(*) AS total FROM d1_migrations");
const applied = Number(ledgerRows[0]?.total ?? -1);
if (applied !== migrationFiles.length)
  throw new Error(
    `Fresh migration ledger mismatch: expected ${migrationFiles.length}, applied ${applied}.`,
  );

console.log(
  `Fresh D1 migration chain verified: ${applied} migrations, required tables/triggers present.`,
);
