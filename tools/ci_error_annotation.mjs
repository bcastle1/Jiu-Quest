// Prints the end of a failed CI step's log as a GitHub Actions error annotation.
// The raw logs of this public repository need a GitHub sign-in, but a check
// run's annotations can be read by anyone through the public API
// (GET /repos/<owner>/<repo>/check-runs/<id>/annotations), so a failure can be
// diagnosed without signing in.
//
// Usage: node tools/ci_error_annotation.mjs <log file> [lines]
// It always exits 0: the step that calls it keeps its own exit status.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const DEFAULT_LINES = 60;

// Workflow commands end at a line break, so the message is escaped the way
// GitHub documents: % first, then carriage returns and line feeds.
export function escapeAnnotation(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

// The last `count` non-empty lines of a log, without terminal colour codes, as
// one ::error annotation line.
export function annotationFor(log, count = DEFAULT_LINES) {
  const lines = log.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  const tail = lines.slice(-count);
  return `::error title=Browser suites failed (last ${tail.length} lines)::${escapeAnnotation(tail.join('\n'))}`;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [file, lines] = process.argv.slice(2);
  let log;
  try { log = readFileSync(file, 'utf8'); } catch { log = `(no log at ${file})`; }
  console.log(annotationFor(log, Number(lines) > 0 ? Number(lines) : DEFAULT_LINES));
}
