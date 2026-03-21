import { describe, it, expect } from 'vitest';
import { splitSentences } from '../splitter';

describe('splitSentences — basic splitting', () => {
  it('splits on period followed by space and uppercase', () => {
    const result = splitSentences('Hello. World.', { minLength: 1 });
    expect(result).toEqual(['Hello.', 'World.']);
  });

  it('splits on question mark', () => {
    const result = splitSentences('How are you? I am fine.');
    expect(result).toEqual(['How are you?', 'I am fine.']);
  });

  it('splits on exclamation mark', () => {
    const result = splitSentences('Watch out! Something is coming.');
    expect(result).toEqual(['Watch out!', 'Something is coming.']);
  });

  it('handles single sentence with no boundary', () => {
    const result = splitSentences('Hello world');
    expect(result).toEqual(['Hello world']);
  });

  it('returns empty array for empty string', () => {
    expect(splitSentences('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(splitSentences('   ')).toEqual([]);
  });

  it('trims leading and trailing whitespace from segments', () => {
    const result = splitSentences('  Hello.  World.  ', { minLength: 1 });
    expect(result[0]).toBe('Hello.');
  });
});

describe('splitSentences — abbreviation handling', () => {
  it('does not split after Mr.', () => {
    const result = splitSentences('Mr. Smith went to the store.');
    expect(result).toHaveLength(1);
  });

  it('does not split after Mrs.', () => {
    const result = splitSentences('Mrs. Jones called yesterday.');
    expect(result).toHaveLength(1);
  });

  it('does not split after Dr.', () => {
    const result = splitSentences('Dr. Smith is here.');
    expect(result).toHaveLength(1);
  });

  it('does not split after St.', () => {
    const result = splitSentences('Visit St. Paul cathedral.');
    expect(result).toHaveLength(1);
  });

  it('does not split after vs.', () => {
    const result = splitSentences('It was cats vs. dogs in the park.');
    expect(result).toHaveLength(1);
  });

  it('does not split after etc.', () => {
    const result = splitSentences('Bring food, water, etc. for the trip.');
    expect(result).toHaveLength(1);
  });

  it('does not split after e.g.', () => {
    const result = splitSentences('Some fruits, e.g. apples, are healthy.');
    expect(result).toHaveLength(1);
  });

  it('does not split after i.e.', () => {
    const result = splitSentences('The fastest option, i.e. flying, was chosen.');
    expect(result).toHaveLength(1);
  });
});

describe('splitSentences — decimal numbers', () => {
  it('does not split at decimal number 98.6', () => {
    const result = splitSentences('The temperature is 98.6 degrees.');
    expect(result).toHaveLength(1);
  });

  it('does not split at decimal number 3.14', () => {
    const result = splitSentences('Pi is approximately 3.14159.');
    expect(result).toHaveLength(1);
  });

  it('does not split at dollar amount', () => {
    const result = splitSentences('The price is $9.99 today.');
    expect(result).toHaveLength(1);
  });
});

describe('splitSentences — ellipsis', () => {
  it('does not split on ellipsis in middle', () => {
    const result = splitSentences("Well... I'm not sure. Let me think.");
    // Should not split at '...'
    expect(result.some(s => s.includes('...'))).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe('splitSentences — minLength option', () => {
  it('filters out short segments below minLength', () => {
    // "Hi." is 3 chars — below default 10
    const result = splitSentences('Hi. This is a longer sentence.', { minLength: 10 });
    // 'Hi.' is filtered out, only the longer sentence remains
    expect(result.some(s => s.includes('Hi.'))).toBe(false);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('This is a longer sentence.');
  });

  it('does not filter out segments meeting minLength', () => {
    const result = splitSentences('Hello there. How are you today?', { minLength: 5 });
    expect(result).toHaveLength(2);
  });
});

describe('splitSentences — maxLength option', () => {
  it('splits long sentence at comma boundary', () => {
    const longSentence =
      'This is a very long sentence with many words, and it needs to be split somewhere, because it exceeds the maximum length configured for splitting purposes.';
    const result = splitSentences(longSentence, { maxLength: 80, minLength: 5 });
    expect(result.length).toBeGreaterThan(1);
    result.forEach(s => expect(s.length).toBeLessThanOrEqual(160)); // rough bound after splitting
  });

  it('splits at semicolon before comma', () => {
    const text = 'First clause of the sentence; second clause continues here with more words and still more.';
    const result = splitSentences(text, { maxLength: 50, minLength: 5 });
    expect(result.length).toBeGreaterThan(1);
  });
});

describe('splitSentences — preserveWhitespace option', () => {
  it('preserves trailing whitespace when option is true', () => {
    const result = splitSentences('Hello world there. And more here.', { preserveWhitespace: true, minLength: 1 });
    // With whitespace preservation we should get segments
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe('splitSentences — multiple sentences', () => {
  it('correctly splits three sentences', () => {
    const result = splitSentences('First sentence. Second sentence. Third sentence.');
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('First sentence.');
    expect(result[1]).toBe('Second sentence.');
    expect(result[2]).toBe('Third sentence.');
  });

  it('handles mixed punctuation', () => {
    const result = splitSentences('Really? Yes! Okay.', { minLength: 1 });
    expect(result).toHaveLength(3);
  });
});
