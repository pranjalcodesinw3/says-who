// A dependency nothing imports is install weight and supply-chain surface. Every declared dependency must be imported by src/ or scripts/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8")) as { dependencies: Record<string, string> };
const sources = ["src", "scripts"].flatMap((d) => readdirSync(`${root}${d}`).filter((f) => /\.(ts|mjs|js)$/.test(f)).map((f) => readFileSync(`${root}${d}/${f}`, "utf8")));

test("every declared dependency is imported somewhere in src/ or scripts/", () => {
  const deps = Object.keys(pkg.dependencies);
  assert.ok(deps.length > 0 && sources.length > 5, "the check has something to look at");
  for (const dep of deps) assert.ok(sources.some((s) => s.includes(`from "${dep}`)), `${dep} is declared but never imported`);
});

test("the README states exactly as many mutants as scripts/mutation-check.sh defines", () => {
  const defined = (readFileSync(`${root}scripts/mutation-check.sh`, "utf8").match(/^mutate "/gm) ?? []).length;
  const claimed = Number(/breaks the guarded code (\d+) ways/.exec(readFileSync(`${root}README.md`, "utf8"))?.[1]);
  assert.ok(defined > 10, "the script defines mutants");
  assert.equal(claimed, defined);
});
