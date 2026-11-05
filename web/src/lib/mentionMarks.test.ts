import type { MentionDto } from '@rove/shared';
import { describe, expect, it } from 'vitest';
import { markMentions } from './mentionMarks';

const mention = (
  nameText: string,
  addressText: string | null,
  evidence = nameText,
): MentionDto => ({
  nameText,
  addressText,
  searchText: null,
  evidence,
});

const marked = (text: string, mentions: MentionDto[]) =>
  markMentions(text, mentions)
    .filter((run) => run.mention !== null)
    .map((run) => `${run.mention}:${run.role}:${run.text}`);

describe('markMentions', () => {
  it('marks each name and its location parts in that mention’s colour, every time they appear', () => {
    const text = '喜茶好喝！📍南山区海上世界\n再去一次喜茶，旁边是Bionic Brew 蛇口';
    expect(
      marked(text, [mention('喜茶', '南山区 海上世界'), mention('Bionic Brew', '蛇口')]),
    ).toEqual([
      '0:name:喜茶',
      '0:place:南山区海上世界',
      '0:name:喜茶',
      '1:name:Bionic Brew',
      '1:place:蛇口',
    ]);
  });

  it('keeps every character, in order', () => {
    const text = 'a 喜茶 b 南山区 c';
    const runs = markMentions(text, [mention('喜茶', '南山区')]);
    expect(runs.map((run) => run.text).join('')).toBe(text);
  });

  it('lets a name win over a location part, and skips one-character parts', () => {
    expect(marked('海上世界店 B1', [mention('海上世界店', '海上世界 B1 店')])).toEqual([
      '0:name:海上世界店',
      '0:place:B1',
    ]);
  });

  it('falls back to the evidence when the name is not in the text as written', () => {
    expect(marked('去了 HEYTEA 喜茶', [mention('Heytea', null, 'HEYTEA 喜茶')])).toEqual([
      '0:name:HEYTEA 喜茶',
    ]);
  });
});
