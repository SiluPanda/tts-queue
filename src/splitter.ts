export interface SplitOptions {
  minLength?: number;
  maxLength?: number;
  preserveWhitespace?: boolean;
}

const DEFAULT_MIN_LENGTH = 10;
const DEFAULT_MAX_LENGTH = 200;

// Abbreviations that should NOT trigger sentence splits
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs',
  'etc', 'e.g', 'i.e', 'fig', 'approx', 'dept', 'est', 'govt',
  'inc', 'corp', 'ltd', 'co', 'u.s', 'u.k', 'u.n',
]);

/**
 * Returns true if the period at `dotIndex` in `text` is likely an abbreviation
 * or decimal, and should NOT be treated as a sentence boundary.
 */
function isNonBoundaryPeriod(text: string, dotIndex: number): boolean {
  // Ellipsis: two or more consecutive periods
  if (text[dotIndex + 1] === '.' || (dotIndex > 0 && text[dotIndex - 1] === '.')) {
    return true;
  }

  // Decimal number: digit.digit
  if (dotIndex > 0 && dotIndex < text.length - 1) {
    const before = text[dotIndex - 1];
    const after = text[dotIndex + 1];
    if (/\d/.test(before) && /\d/.test(after)) {
      return true;
    }
  }

  // Abbreviation: find the word before the period
  const beforeDot = text.slice(0, dotIndex);
  const wordMatch = beforeDot.match(/([A-Za-z](?:[A-Za-z.]*[A-Za-z])?)$/);
  if (wordMatch) {
    const word = wordMatch[1].toLowerCase();
    // Check if it's a known abbreviation (with or without embedded dots)
    if (ABBREVIATIONS.has(word)) {
      return true;
    }
    // Single uppercase letter (initials): A. B. C.
    if (/^[a-z]$/.test(word)) {
      return true;
    }
  }

  // URL/hostname pattern: word.word (no space immediately after period before next word char)
  // e.g. example.com — look at what follows the period
  if (dotIndex < text.length - 1) {
    const after = text[dotIndex + 1];
    // If followed directly by a letter or digit (no space), it's likely a URL/domain
    if (/[a-zA-Z0-9]/.test(after)) {
      return true;
    }
  }

  return false;
}

/**
 * Find candidate sentence boundary positions in text.
 * Returns array of indices just AFTER the punctuation mark.
 */
function findBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // Track quoted strings (simple heuristic)
    if ((ch === '"' || ch === '\u201c' || ch === '\u201d') && !inQuote) {
      inQuote = true;
      quoteChar = ch === '\u201c' ? '\u201d' : '"';
    } else if (inQuote && ch === quoteChar) {
      inQuote = false;
    }

    if (inQuote) continue;

    if (ch === '!' || ch === '?') {
      // Always a boundary (after these chars)
      boundaries.push(i + 1);
    } else if (ch === '.') {
      if (!isNonBoundaryPeriod(text, i)) {
        boundaries.push(i + 1);
      }
    }
  }

  return boundaries;
}

/**
 * Split a single overlong segment at clause boundaries:
 * semicolon, em-dash, then comma (only if both halves meet minLength).
 */
function splitAtClauseBoundaries(segment: string, maxLength: number, minLength: number): string[] {
  if (segment.length <= maxLength) return [segment];

  // Try splitting at semicolon
  const semiIdx = segment.lastIndexOf('; ', maxLength);
  if (semiIdx > minLength) {
    const left = segment.slice(0, semiIdx + 1).trimEnd();
    const right = segment.slice(semiIdx + 2).trimStart();
    if (left.length >= minLength && right.length >= minLength) {
      return [
        ...splitAtClauseBoundaries(left, maxLength, minLength),
        ...splitAtClauseBoundaries(right, maxLength, minLength),
      ];
    }
  }

  // Try em-dash patterns
  for (const dash of [' \u2014 ', ' -- ', '\u2014']) {
    const dashIdx = segment.lastIndexOf(dash, maxLength);
    if (dashIdx > minLength) {
      const left = segment.slice(0, dashIdx).trimEnd();
      const right = segment.slice(dashIdx + dash.length).trimStart();
      if (left.length >= minLength && right.length >= minLength) {
        return [
          ...splitAtClauseBoundaries(left, maxLength, minLength),
          ...splitAtClauseBoundaries(right, maxLength, minLength),
        ];
      }
    }
  }

  // Try comma
  const commaIdx = segment.lastIndexOf(', ', maxLength);
  if (commaIdx > minLength) {
    const left = segment.slice(0, commaIdx + 1).trimEnd();
    const right = segment.slice(commaIdx + 2).trimStart();
    if (left.length >= minLength && right.length >= minLength) {
      return [
        ...splitAtClauseBoundaries(left, maxLength, minLength),
        ...splitAtClauseBoundaries(right, maxLength, minLength),
      ];
    }
  }

  // Cannot split further — return as-is
  return [segment];
}

export function splitSentences(text: string, options?: SplitOptions): string[] {
  const minLength = options?.minLength ?? DEFAULT_MIN_LENGTH;
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const preserveWhitespace = options?.preserveWhitespace ?? false;

  if (!text || text.trim().length === 0) return [];

  const boundaries = findBoundaries(text);

  // Build raw segments from boundaries
  const rawSegments: string[] = [];
  let start = 0;
  for (const end of boundaries) {
    const raw = preserveWhitespace
      ? text.slice(start, end)
      : text.slice(start, end).trim();
    if (raw.length > 0) rawSegments.push(raw);
    start = preserveWhitespace ? end : skipWhitespace(text, end);
  }
  // Remainder after last boundary
  const remainder = preserveWhitespace
    ? text.slice(start)
    : text.slice(start).trim();
  if (remainder.length > 0) rawSegments.push(remainder);

  // Apply maxLength splitting
  const lengthSplit: string[] = [];
  for (const seg of rawSegments) {
    const parts = splitAtClauseBoundaries(seg, maxLength, minLength);
    lengthSplit.push(...parts);
  }

  // Filter out empty strings and strings shorter than minLength
  return lengthSplit.filter(s => {
    const trimmed = preserveWhitespace ? s : s.trim();
    return trimmed.length >= minLength;
  });
}

function skipWhitespace(text: string, pos: number): number {
  while (pos < text.length && /\s/.test(text[pos])) pos++;
  return pos;
}
