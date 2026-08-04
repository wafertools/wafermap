#!/usr/bin/env node
// Generates docs/agents.md from AGENTS.md.
//
// AGENTS.md is the single source. The docs page wraps the block between the
// RULES markers in a fenced code block so a developer can copy it wholesale into
// their own project's CLAUDE.md / AGENTS.md / .cursorrules — which is where their
// agent will actually read it. Two hand-maintained copies of these rules would
// drift, and a drifted agent guide is worse than none.
//
// Run:  node scripts/build-agents-page.mjs [--check]
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = resolve(root, 'AGENTS.md');
const OUT    = resolve(root, 'docs/agents.md');

const src   = readFileSync(AGENTS, 'utf8');
const match = src.match(/<!-- RULES:START -->([\s\S]*?)<!-- RULES:END -->/);
if (!match) {
  console.error('build-agents-page: AGENTS.md is missing its <!-- RULES:START/END --> markers.');
  process.exit(1);
}
const rules = match[1].trim();

// The rules contain inline backticks and may contain fenced samples, so the
// wrapper fence has to be longer than anything inside it.
const longest = Math.max(0, ...[...rules.matchAll(/^`{3,}/gm)].map(m => m[0].length));
const fence   = '`'.repeat(Math.max(4, longest + 1));

const page = `# Using wafermap with an AI coding agent

**For:** developers whose day-to-day coding runs through Claude Code, Codex, Copilot,
Cursor or similar. **See also:** [Developer Guide](guide.md) · [API Reference](api.md)

Wafer maps drive yield calls, lot dispositions and process changes. The dangerous
failure is not code that crashes — it is a map that looks entirely reasonable and is
wrong. Several of this library's inputs invite a confident wrong guess:
\`die.hbin ?? 0\` reads as ordinary defensive coding but turns no-data dies into bin 0
and moves the yield number; \`activeTest\` reads like an array index but is a test
number.

The rules below are the ones worth loading before an agent writes wafer map code.

## Give these rules to your agent

Copy this block into your project's agent config — \`CLAUDE.md\`, \`AGENTS.md\`,
\`.cursorrules\`, \`.github/copilot-instructions.md\`, whichever your tool reads.

${fence}markdown
${rules}
${fence}

## Keeping it honest

An agent guide that names a removed API is worse than no guide, because an agent
will follow it confidently. Everything checkable in the block above is asserted
against the built type declarations by \`scripts/check-agents-guide.mjs\`, which runs
in \`npm run check\` and in CI: every recommended symbol must still exist, every
symbol listed as removed must still be absent, and structural claims — that
\`DieResult\` has no \`values\`, that \`TestDef\` has no \`index\` — are verified against
\`dist/**/*.d.ts\` rather than trusted.

If a rule here and the [API Reference](api.md) ever disagree, the API Reference is
correct and this page has a bug worth reporting.

## Also shipped

- \`AGENTS.md\` in the [repository](https://github.com/wafertools/wafermap/blob/main/AGENTS.md)
  and in the npm package, so \`node_modules/@wafertools/wafermap/AGENTS.md\` is readable
  when you point an agent at the installed package.
- \`llms.txt\` in the package — a short machine-readable map of the docs and entry points.
- \`AGENTS.md\` at the root of the
  [examples package](wafermap-examples.zip), since opening an agent inside that
  folder to adapt an example is a realistic way to start.
`;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== page) {
    console.error('docs/agents.md is out of date with AGENTS.md.\nRun: node scripts/build-agents-page.mjs');
    process.exit(1);
  }
  console.log('agents page up to date');
} else {
  writeFileSync(OUT, page);
  console.log(`wrote ${OUT}`);
}
