import { validProjectSlug } from "../shared/project-slug-policy.js";

const [slugArg, nameArg, locationArg = ""] = process.argv.slice(2);

const slug = String(slugArg || "").trim().toLowerCase();
const name = String(nameArg || "").trim();
const location = String(locationArg || "").trim();

if (!validProjectSlug(slug)) {
  throw new Error(
    "Slug must be 2-80 lowercase letters, numbers and single hyphens, and must not use an Engine-reserved route.",
  );
}
if (name.length < 2 || name.length > 120) {
  throw new Error("Project name must be 2-120 characters.");
}
if (location.length > 180) {
  throw new Error("Location must be 180 characters or fewer.");
}

const projectId = `project_${slug.replaceAll("-", "_")}`;
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

process.stdout.write(`INSERT INTO projects_3d (
  id, slug, name, location, status, created_at, updated_at
) VALUES (
  ${sqlString(projectId)},
  ${sqlString(slug)},
  ${sqlString(name)},
  ${location ? sqlString(location) : "NULL"},
  'draft',
  datetime('now'),
  datetime('now')
)
ON CONFLICT(slug) DO NOTHING;

SELECT id, slug, name, location, status
FROM projects_3d
WHERE slug = ${sqlString(slug)}
LIMIT 1;
`);
