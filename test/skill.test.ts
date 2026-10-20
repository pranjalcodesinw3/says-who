// The skill is documentation that an agent obeys, so every claim it makes about the code is checked against the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERDICTS, assess } from "../src/provenance.ts";
import { tvContext } from "../src/tv.ts";
import { FIXTURE_OWNER, WEARER_CONVO, FACT_OAT } from "./fixtures/fixture-bee.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const skill = readFileSync(`${root}skills/receipts/SKILL.md`, "utf8");
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8")) as { scripts: Record<string, string> };
const cliSrc = readFileSync(`${root}src/cli.ts`, "utf8");

test("frontmatter has the name matching its folder and a trigger-rich description", () => {
  const fm = /^---\nname: (.+)\ndescription: "(.+)"\n---\n/s.exec(skill);
  assert.ok(fm, "frontmatter shape matches bee-skill: name then description");
  assert.equal(fm![1], "receipts");
  assert.ok(fm![2]!.length > 200);
  assert.match(fm![2]!, /why does Bee think/i);
});

test("every `npm run X` the skill tells an agent to run exists in package.json and in the CLI", () => {
  const used = [...skill.matchAll(/npm run ([a-z-]+)/g)].map((m) => m[1]!);
  assert.ok(used.length >= 4, "found the commands");
  for (const name of new Set(used)) {
    assert.ok(pkg.scripts[name], `package.json has script ${name}`);
    const sub = /cli\.ts (\w+)/.exec(pkg.scripts[name]!)![1]!;
    assert.ok(cliSrc.includes(`case "${sub}"`), `cli.ts handles ${sub}`);
  }
});

test("every verdict the code can emit is documented, and no other verdict is", () => {
  for (const v of VERDICTS) assert.ok(skill.includes(`| \`${v}\``), `verdict ${v} documented`);
  const rows = [...skill.matchAll(/^\| `([a-z-]+)` \| "/gm)].map((m) => m[1]);
  assert.deepEqual([...rows].sort(), [...VERDICTS].sort());
});

test("every field of a real receipt is documented", () => {
  const r = assess(FACT_OAT, [WEARER_CONVO], { ownerNames: FIXTURE_OWNER.split(" "), tv: tvContext(FIXTURE_OWNER) });
  for (const key of Object.keys(r)) assert.ok(skill.includes(`\`${key}\``), `field ${key} documented in SKILL.md`);
});

test("receipts.skill is a zip with exactly one entry, receipts/SKILL.md, identical to the file", () => {
  const list = execFileSync("unzip", ["-Z1", `${root}skills/receipts.skill`], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(list, ["receipts/SKILL.md"]);
  assert.equal(execFileSync("unzip", ["-p", `${root}skills/receipts.skill`, "receipts/SKILL.md"], { encoding: "utf8" }), skill);
});
