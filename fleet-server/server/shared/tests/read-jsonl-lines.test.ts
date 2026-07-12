// [fork-fix #1] Regression tests for readJsonlLines-based JSONL parsing:
// raw U+2028/U+2029 inside JSON strings must not break line splitting
// (upstream's readline-based reader split on them — siteboon/claudecodeui#1002),
// and a malformed line must not abort the rest of the file.
//
// Note: JSON.stringify escapes U+2028/U+2029, so the offending lines are
// assembled by hand — exactly like Claude Code, which writes the characters
// raw into transcript files (they are legal unescaped in JSON strings).

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildLookupMap, extractFirstValidJsonlData, readJsonlLines } from '@/shared/utils.js';

const LS = '\u2028'; // LINE SEPARATOR, written raw to disk
const PS = '\u2029'; // PARAGRAPH SEPARATOR

const writeTempJsonl = async (lines: string[]): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-jsonl-'));
  const filePath = path.join(dir, 'session.jsonl');
  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
  return filePath;
};

test('readJsonlLines keeps raw U+2028/U+2029 inside a line', async () => {
  const rawLine = `{"sessionId":"s1","cwd":"/tmp/project","text":"pasted${LS}text${PS}here"}`;
  const filePath = await writeTempJsonl([
    rawLine,
    '{"sessionId":"s1","text":"plain line"}',
  ]);

  const lines: string[] = [];
  for await (const line of readJsonlLines(filePath)) {
    if (line.trim()) lines.push(line);
  }

  assert.equal(lines.length, 2);
  const parsed = JSON.parse(lines[0]) as { text: string };
  assert.equal(parsed.text, `pasted${LS}text${PS}here`);
});

test('extractFirstValidJsonlData survives U+2028 lines and malformed lines', async () => {
  const filePath = await writeTempJsonl([
    '{"broken": "truncated line without closing',
    `{"note":"has${LS}separator","cwd":null}`,
    '{"sessionId":"s2","cwd":"/tmp/project"}',
  ]);

  const extracted = await extractFirstValidJsonlData(filePath, (parsed) => {
    const row = parsed as { sessionId?: string; cwd?: string | null };
    return row.cwd ? { sessionId: row.sessionId, cwd: row.cwd } : null;
  });

  assert.deepEqual(extracted, { sessionId: 's2', cwd: '/tmp/project' });
});

test('buildLookupMap skips malformed lines instead of aborting the file', async () => {
  const filePath = await writeTempJsonl([
    '{"sessionId":"a","summary":"first"}',
    '{not json at all',
    `{"sessionId":"b","summary":"with${LS}separator"}`,
  ]);

  const lookup = await buildLookupMap(filePath, 'sessionId', 'summary');

  assert.equal(lookup.get('a'), 'first');
  assert.equal(lookup.get('b'), `with${LS}separator`);
});

test('readJsonlLines handles CRLF and a final line without newline', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-jsonl-'));
  const filePath = path.join(dir, 'crlf.jsonl');
  await fs.writeFile(filePath, '{"a":1}\r\n{"b":2}', 'utf8');

  const lines: string[] = [];
  for await (const line of readJsonlLines(filePath)) {
    lines.push(line);
  }

  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});
