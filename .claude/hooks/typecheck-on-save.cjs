#!/usr/bin/env node
// PostToolUse (Edit/Write) on *.ts/*.tsx: run the owning workspace's
// `typecheck` script so TS7 breakage surfaces same-turn, not at next full test run.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath || !/\.(ts|tsx)$/.test(filePath)) process.exit(0);

  const root = input.cwd || process.cwd();
  const absFilePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath);
  let dir = path.dirname(absFilePath);
  let pkgDir = null;
  while (dir.startsWith(root)) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      pkgDir = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!pkgDir) process.exit(0);

  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  if (!pkg.scripts || !pkg.scripts.typecheck) process.exit(0);

  try {
    execFileSync("pnpm", ["run", "typecheck"], {
      cwd: pkgDir,
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
    });
  } catch (err) {
    const out = (err.stdout || "") + (err.stderr || "");
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `typecheck fallito in ${pkgDir}:\n${out.slice(0, 4000)}`,
        },
      })
    );
  }
  process.exit(0);
});
