#!/usr/bin/env node
// PreToolUse guard: blocks Edit on a db/migrations/*.sql file that is already
// committed to git (i.e. already shipped). Forces a new migration file instead
// of mutating an applied one. Write (new file) is unaffected.
const { execFileSync } = require("node:child_process");

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = input.tool_name;
  const filePath = input.tool_input && input.tool_input.file_path;
  if (toolName !== "Edit" || !filePath) process.exit(0);

  const normalized = filePath.replace(/\\/g, "/");
  if (!/(^|\/)db\/migrations\/.*\.(up|down)\.sql$/.test(normalized)) process.exit(0);

  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--oneline", "--", filePath],
      { cwd: input.cwd || process.cwd(), encoding: "utf8" }
    ).trim();
    if (out) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason:
            `Migration ${filePath} è già committata (già applicata/shippata). ` +
            `Non editarla: crea una nuova migration invece.`,
        })
      );
      process.exit(0);
    }
  } catch {
    // git failure -> don't block, fail open
  }
  process.exit(0);
});
