import { describe, expect, it } from 'vitest';
import { validateMentions } from './extractService';

/* The structural half of "the model never originates a fact". Everything the model proposes
   passes through here, and only what it can point at in the source survives. */

const TEXT = '周末去了文和友，人超多。然后在 Bionic Brew 喝了一杯，在南山区。';

describe('validateMentions', () => {
  it('keeps a mention whose evidence is a verbatim quote containing the name', () => {
    const kept = validateMentions(
      [{ nameText: '文和友', addressText: null, evidence: '去了文和友，人超多' }],
      TEXT,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].nameText).toBe('文和友');
  });

  it('drops a mention whose evidence is not in the text — a paraphrase is an invention', () => {
    const kept = validateMentions(
      [{ nameText: '文和友', addressText: null, evidence: '文和友 in Shenzhen' }],
      TEXT,
    );
    expect(kept).toEqual([]);
  });

  it('drops a mention whose name is not inside its own evidence', () => {
    const kept = validateMentions(
      [{ nameText: 'Starbucks', addressText: null, evidence: '人超多' }],
      TEXT,
    );
    expect(kept).toEqual([]);
  });

  it('keeps the mention but blanks an address the text does not contain', () => {
    const kept = validateMentions(
      [{ nameText: 'Bionic Brew', addressText: '海上世界', evidence: '在 Bionic Brew 喝了一杯' }],
      TEXT,
    );
    expect(kept[0].addressText).toBeNull();
    const withAddress = validateMentions(
      [{ nameText: 'Bionic Brew', addressText: '南山区', evidence: '在 Bionic Brew 喝了一杯' }],
      TEXT,
    );
    expect(withAddress[0].addressText).toBe('南山区');
  });

  it('de-duplicates by folded name', () => {
    const kept = validateMentions(
      [
        { nameText: 'Bionic Brew', addressText: null, evidence: 'Bionic Brew 喝了一杯' },
        { nameText: 'bionic brew', addressText: null, evidence: 'Bionic Brew 喝了一杯' },
      ],
      TEXT,
    );
    expect(kept).toHaveLength(1);
  });
});
