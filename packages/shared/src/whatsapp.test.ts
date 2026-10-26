import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ALPHABET } from './alphabet.ts';
import { isTokenShape } from './token.ts';
import {
  normaliseWaText,
  painterConfirmLink,
  painterConfirmText,
  parseWaMessage,
  waShareLink,
} from './whatsapp.ts';

describe('normaliseWaText', () => {
  it('EC-072 converts Devanagari digits, uppercases and strips punctuation/emoji', () => {
    expect(normaliseWaText('  paid  k७q२m९ 🙏 ')).toBe('PAID K7Q2M9');
    expect(normaliseWaText('Ｋ７Ｑ２Ｍ９')).toBe('K7Q2M9'); // NFKC full-width
  });
});

describe('parseWaMessage', () => {
  it('EC-070 exact prefilled message', () => {
    expect(parseWaMessage('text', '24M PAID K7Q2M9')).toEqual({
      intent: 'CONFIRM',
      token: 'K7Q2M9',
    });
  });

  it('EC-071 lowercase / extra words / emojis', () => {
    expect(parseWaMessage('text', 'k7q2m9')).toMatchObject({ token: 'K7Q2M9' });
    expect(parseWaMessage('text', 'Paid K7Q2M9 🙏')).toMatchObject({ token: 'K7Q2M9' });
    expect(parseWaMessage('text', 'bhai, 24m paid: K7Q2M9!!')).toMatchObject({ token: 'K7Q2M9' });
  });

  it('maps look-alikes inside a candidate token', () => {
    expect(parseWaMessage('text', '24M PAID K7QIMO')).toMatchObject({ token: 'K7Q1M0' });
  });

  it('does not accept a token split by spaces', () => {
    expect(parseWaMessage('text', 'K7Q2 M9').intent).toBe('HELP');
  });

  it('ordinary 6-letter words are not tokens', () => {
    expect(parseWaMessage('text', 'THANKS BHAIYA').intent).toBe('HELP');
  });

  it('dispute phrases (whole message)', () => {
    for (const msg of [
      'no',
      'No.',
      'NOT PAID',
      'nahi',
      'Nahi mila',
      'नहीं',
      'नाही',
      'paise nahi mile',
    ]) {
      expect(parseWaMessage('text', msg)).toEqual({ intent: 'DISPUTE', token: null });
    }
    expect(parseWaMessage('text', 'no thanks').intent).toBe('HELP');
  });

  it('stop words', () => {
    for (const msg of ['stop', 'DELETE', 'Unsubscribe']) {
      expect(parseWaMessage('text', msg).intent).toBe('STOP');
    }
  });

  it('EC-083 non-text and empty messages get help', () => {
    for (const type of ['image', 'audio', 'sticker', 'location', 'voice']) {
      expect(parseWaMessage(type, null).intent).toBe('HELP');
    }
    expect(parseWaMessage('text', null).intent).toBe('HELP');
    expect(parseWaMessage('text', undefined).intent).toBe('HELP');
    expect(parseWaMessage('text', 'hello').intent).toBe('HELP');
  });

  const tokenArb = fc
    .array(fc.constantFrom(...Array.from(ALPHABET)), { minLength: 6, maxLength: 6 })
    .map((a) => a.join(''))
    .filter(isTokenShape);
  const noiseArb = fc.string({ maxLength: 20 }).map((s) => s.replace(/[\p{L}\p{N}\p{M}]/gu, ''));

  it('property: a token surrounded by noise in any case is found', () => {
    fc.assert(
      fc.property(tokenArb, noiseArb, noiseArb, fc.boolean(), (token, pre, post, lower) => {
        const body = `${pre} ${lower ? token.toLowerCase() : token} ${post}`;
        const r = parseWaMessage('text', body);
        return r.intent === 'CONFIRM' && r.token === token;
      }),
    );
  });

  it('property: strings with no 6-char alphanumeric word never CONFIRM', () => {
    const wordArb = fc.string({ minLength: 0, maxLength: 5 });
    fc.assert(
      fc.property(fc.array(wordArb, { maxLength: 6 }), (words) => {
        const body = words.map((w) => w.replace(/[^A-Za-z0-9]/g, '')).join(' ');
        return parseWaMessage('text', body).intent !== 'CONFIRM';
      }),
    );
  });
});

describe('links', () => {
  it('builds the painter wa.me link', () => {
    expect(painterConfirmText('K7Q2M9')).toBe('24M PAID K7Q2M9');
    expect(painterConfirmLink('+91 98765 43210', 'K7Q2M9')).toBe(
      'https://wa.me/919876543210?text=24M%20PAID%20K7Q2M9',
    );
  });

  it('builds share links', () => {
    expect(waShareLink('+919876543210', 'Hi & bye')).toBe(
      'https://wa.me/919876543210?text=Hi%20%26%20bye',
    );
  });
});
