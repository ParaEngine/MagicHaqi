import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

test('expedition history review records one anonymous event per run', () => {
    assert.match(source, /onReviewHistory: runId => \{/);
    assert.match(source, /firstDayContext\(\{ runId: historyRunId \}\)/);
    assert.match(source, /dedupeKey: `\$\{planetId\}:expedition-history-reviewed:\$\{historyRunId\}`/);
});