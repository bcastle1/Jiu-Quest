import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_LINES, annotationFor, escapeAnnotation } from '../tools/ci_error_annotation.mjs';

test('the annotation escapes percent signs and line breaks as GitHub workflow commands need', () => {
  assert.equal(escapeAnnotation('100% done\r\nnext\nline'), '100%25 done%0D%0Anext%0Aline');
});

test('the annotation carries the last non-empty lines of the log, without colour codes, on one line', () => {
  const log = ['first', '', '\x1b[31mAssertionError: heading\x1b[0m', '   at check (tools/x.mjs:1:1)', ''].join('\n');
  const line = annotationFor(log, 2);
  assert.equal(line, '::error title=Browser suites failed (last 2 lines)::AssertionError: heading%0A   at check (tools/x.mjs:1:1)');
  assert.ok(!line.includes('\n') && !line.includes('\r'));
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\r\n');
  assert.ok(annotationFor(long).startsWith(`::error title=Browser suites failed (last ${DEFAULT_LINES} lines)::line 40%0Aline 41`));
  assert.ok(annotationFor(long).endsWith('%0Aline 99'));
});

test('the command prints one annotation for a log file and exits 0, also when the file is missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-annotation-'));
  const file = path.join(dir, 'browser.log');
  writeFileSync(file, 'ok\nError: the clip stage never appeared\n');
  const tool = path.resolve('tools/ci_error_annotation.mjs');
  assert.equal(execFileSync(process.execPath, [tool, file], { encoding: 'utf8' }).trim(), '::error title=Browser suites failed (last 2 lines)::ok%0AError: the clip stage never appeared');
  assert.match(execFileSync(process.execPath, [tool, path.join(dir, 'missing.log')], { encoding: 'utf8' }), /^::error title=Browser suites failed \(last 1 lines\)::\(no log at /);
});

test('the deploy workflow runs the browser suites in bash with pipefail, keeps their exit status, and annotates a failure', () => {
  const workflow = readFileSync('.github/workflows/deploy-pages.yml', 'utf8').replaceAll('\r\n', '\n');
  const step = workflow.slice(workflow.indexOf('      - name: Verify real Unity player and mobile layouts'), workflow.indexOf('      - name: Record exact release'));
  assert.match(step, /\n        shell: bash\n/);
  assert.match(step, /\n          set -o pipefail\n/);
  assert.match(step, /\n          pnpm test:browser 2>&1 \| tee browser-suites\.log \|\| status=\$\?\n/);
  assert.match(step, /\n          if \[ "\$status" -ne 0 \]; then node tools\/ci_error_annotation\.mjs browser-suites\.log \|\| true; fi\n/);
  assert.match(step, /\n          exit "\$status"\n/);
});
