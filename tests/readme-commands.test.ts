import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createReadmeCommandKey,
  createReadmeCommandLabel,
  isReadmePath,
  parseExecutableReadmeCommands
} from "../src/readme-command-model.ts";

test("creates stable README command keys that change with command content", () => {
  const first = createReadmeCommandKey("project/README.md", "npm run dev");

  assert.equal(first, createReadmeCommandKey("project/README.md", "npm run dev"));
  assert.notEqual(first, createReadmeCommandKey("project/README.md", "npm run build"));
});

test("recognizes README paths case-insensitively", () => {
  assert.equal(isReadmePath("project/README.md"), true);
  assert.equal(isReadmePath("project/readme.MD"), true);
  assert.equal(isReadmePath("project/README.notes.md"), false);
});

test("labels README command blocks from their first line", () => {
  assert.equal(createReadmeCommandLabel("npm run build"), "README: npm run build");
  assert.equal(createReadmeCommandLabel("npm install\nnpm run dev"), "README: npm install …");
  assert.equal(createReadmeCommandLabel("", "Befehl"), "README: Befehl");
});

test("extracts supported shell blocks from README Markdown", () => {
  const commands = parseExecutableReadmeCommands([
    "```bash",
    "npm install",
    "npm run dev",
    "```",
    "",
    "```json",
    "{}",
    "```"
  ].join("\n"));

  assert.deepEqual(commands, ["npm install\nnpm run dev"]);
});

test("normalizes Windows line endings in README command blocks", () => {
  const contents = "```bash\r\nnpm install\r\nnpm run dev\r\n```\r\n";

  assert.deepEqual(parseExecutableReadmeCommands(contents), ["npm install\nnpm run dev"]);
});

test("requires a closing README fence at least as wide as its opening fence", () => {
  const contents = [
    "````bash",
    "printf '%s\\n' '```'",
    "````"
  ].join("\n");

  assert.deepEqual(parseExecutableReadmeCommands(contents), ["printf '%s\\n' '```'"]);
  assert.deepEqual(parseExecutableReadmeCommands("```sh\necho ok\n````"), ["echo ok"]);
});
