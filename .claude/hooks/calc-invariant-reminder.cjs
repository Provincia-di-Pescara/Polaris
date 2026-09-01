#!/usr/bin/env node
// PreToolUse (Edit/Write) reminder: touching calc-domain code without having
// re-read docs/claude/regole-calcolo.md is the most common way to violate the
// determinism / rounding invariants documented there. Non-blocking nudge only.
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
  if (!filePath) process.exit(0);

  const normalized = filePath.replace(/\\/g, "/");
  const isCalcDomain =
    /(^|\/)engine-go\/internal\/(calc|sorteggio|roundrobin|istruttoria|gara)\//.test(
      normalized
    ) ||
    /(^|\/)backend-node\/src\/.*(fabbisogn|isf|concertazion|assegnazion|round.?robin|sorteggi)/i.test(
      normalized
    );
  if (!isCalcDomain) process.exit(0);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext:
          "File in dominio calcolo/business-rule. Rileggi docs/claude/regole-calcolo.md " +
          "prima di modificare formule FR/ISF/CP, ordine fasce, sorteggio o loop round-robin: " +
          "sono regole di dominio vincolanti sia Go che Node, non derivabili dal solo codice.",
      },
    })
  );
  process.exit(0);
});
