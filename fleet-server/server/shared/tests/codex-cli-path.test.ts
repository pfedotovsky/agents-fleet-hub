import { describe, expect, test } from 'bun:test';

import {
  parseCodexCliVersion,
  selectNewestCodexCliPath,
  type CodexCliVersion,
} from '@/shared/codex-cli-path.js';

describe('Codex CLI resolution', () => {
  test('parses stable and prerelease CLI version output', () => {
    expect(parseCodexCliVersion('codex-cli 0.146.0')).toEqual([0, 146, 0]);
    expect(parseCodexCliVersion('codex-cli 0.147.0-alpha.4')).toEqual([0, 147, 0]);
    expect(parseCodexCliVersion('unknown')).toBeNull();
  });

  test('chooses the newest compatible installed CLI', () => {
    const versions = new Map<string, CodexCliVersion>([
      ['/opt/homebrew/bin/codex', [0, 144, 1]],
      ['/Applications/ChatGPT.app/Contents/Resources/codex', [0, 146, 0]],
    ]);

    expect(selectNewestCodexCliPath([...versions.keys()], (candidate) => versions.get(candidate) ?? null))
      .toBe('/Applications/ChatGPT.app/Contents/Resources/codex');
  });

  test('keeps the first candidate when versions tie or cannot be read', () => {
    expect(selectNewestCodexCliPath(['/path/codex', '/app/codex'], () => [0, 146, 0]))
      .toBe('/path/codex');
    expect(selectNewestCodexCliPath(['/custom/codex'], () => null)).toBe('/custom/codex');
  });
});
