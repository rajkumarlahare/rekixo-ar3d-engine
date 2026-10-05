import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Admin no longer exposes legacy Studio as a production entry route", () => {
  const main = read("apps/admin/src/main.tsx");

  assert.doesNotMatch(main, /lazy\(\(\) => import\("\.\/studio\/Studio"\)\)/);
  assert.match(main, /function LegacyStudioRedirect\(\)/);
  assert.match(
    main,
    /window\.location\.replace\(`\/3Dprojects\/source-pack\$\{window\.location\.search\}`\)/,
  );
  assert.match(
    main,
    /if \(path === "\/3Dprojects\/studio"\) \{\s*return <LegacyStudioRedirect \/>;\s*\}/,
  );
});

test("Automatic Source Pack route remains the primary supported engine entry", () => {
  const main = read("apps/admin/src/main.tsx");

  assert.match(main, /if \(path === "\/3Dprojects\/source-pack"\)/);
  assert.match(main, /<SourcePackReview \/>/);
  assert.match(main, /<small>AUTOMATIC ENGINE<\/small>/);
});
