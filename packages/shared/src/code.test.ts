import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ALPHABET } from './alphabet.ts';
import { couponQrUrl, displayCode, generateCode, normaliseCode } from './code.ts';
import { luhn32CheckChar } from './luhn32.ts';

const CODE = `7KQ2M9XHTB4R${luhn32CheckChar('7KQ2M9XHTB4R')}`;
const codeArb = fc
  .array(fc.constantFrom(...Array.from(ALPHABET)), { minLength: 12, maxLength: 12 })
  .map((a) => a.join(''))
  .map((p) => p + luhn32CheckChar(p));

describe('generateCode', () => {
  it('is 13 valid characters', () => {
    const c = generateCode();
    expect(c).toHaveLength(13);
    expect(normaliseCode(c)).toEqual({ ok: true, code: c, key: c.slice(0, 12) });
  });

  it('uses the supplied byte source', () => {
    const c = generateCode((n) => new Uint8Array(n));
    expect(c).toBe('0000000000000');
  });
});

describe('displayCode / couponQrUrl', () => {
  it('groups in fours', () => {
    expect(displayCode(CODE)).toBe(`7KQ2-M9XH-TB4R-${CODE.slice(-1)}`);
    expect(displayCode('')).toBe('');
  });

  it('builds an uppercase QR URL', () => {
    expect(couponQrUrl('c.example.in', CODE)).toBe(`HTTPS://C.EXAMPLE.IN/C/${CODE}`);
  });
});

describe('normaliseCode', () => {
  it('EC-001 lowercase is accepted', () => {
    expect(normaliseCode(CODE.toLowerCase())).toMatchObject({ ok: true, code: CODE });
  });

  it('EC-002 spaces and hyphens are accepted', () => {
    expect(normaliseCode(` ${displayCode(CODE)} `)).toMatchObject({ ok: true, code: CODE });
    expect(normaliseCode('7KQ2 M9XH TB4R ' + CODE.slice(-1))).toMatchObject({ ok: true });
  });

  it('EC-003 O→0 and I/L→1', () => {
    const c = `10${'A'.repeat(10)}`;
    const full = c + luhn32CheckChar(c);
    expect(normaliseCode(`IO${'A'.repeat(10)}${full.slice(-1)}`)).toMatchObject({ code: full });
    expect(normaliseCode(`LO${'A'.repeat(10)}${full.slice(-1)}`)).toMatchObject({ code: full });
  });

  it('EC-004 U is invalid', () => {
    expect(normaliseCode(`U${CODE.slice(1)}`)).toEqual({ ok: false, reason: 'BAD_CHARS' });
  });

  it('EC-005 wrong check character', () => {
    const wrong = CODE.slice(0, 12) + (CODE.endsWith('0') ? '1' : '0');
    expect(normaliseCode(wrong)).toEqual({ ok: false, reason: 'BAD_CHECK' });
  });

  it('EC-006 12 characters is invalid', () => {
    expect(normaliseCode(CODE.slice(0, 12))).toEqual({ ok: false, reason: 'BAD_LENGTH' });
    expect(normaliseCode(`${CODE}0`)).toEqual({ ok: false, reason: 'BAD_LENGTH' });
  });

  it('empty input', () => {
    expect(normaliseCode('   ')).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('EC-007 full URL pasted', () => {
    expect(normaliseCode(`https://c.example.in/c/${CODE}`)).toMatchObject({ code: CODE });
    expect(normaliseCode(`HTTPS://C.EXAMPLE.IN/C/${CODE}`)).toMatchObject({ code: CODE });
    expect(normaliseCode(`c.example.in/c/${CODE}`)).toMatchObject({ code: CODE });
    expect(normaliseCode(`https://c.example.in/c/${CODE}/`)).toMatchObject({ code: CODE });
  });

  it('EC-008 another product QR is not a 24M coupon', () => {
    expect(normaliseCode('https://other.brand.com/p/123')).toEqual({
      ok: false,
      reason: 'NOT_24M',
    });
    expect(normaliseCode(`https://evil.com/c/${CODE}`, 'c.example.in')).toEqual({
      ok: false,
      reason: 'NOT_24M',
    });
    expect(normaliseCode(`https://c.example.in/c/${CODE}`, 'C.EXAMPLE.IN')).toMatchObject({
      ok: true,
    });
    expect(normaliseCode('http://[bad')).toEqual({ ok: false, reason: 'NOT_24M' });
  });

  it('EC-009 tracking params are ignored', () => {
    expect(normaliseCode(`https://c.example.in/c/${CODE}?utm_source=x#frag`)).toMatchObject({
      code: CODE,
    });
  });

  it('property: normalise(display(code)) == code, tolerant of case/space/hyphen', () => {
    fc.assert(
      fc.property(codeArb, fc.boolean(), (code, lower) => {
        const shown = displayCode(code);
        const input = lower ? shown.toLowerCase() : shown.replace(/-/g, ' ');
        const r = normaliseCode(input);
        return r.ok && r.code === code && r.key === code.slice(0, 12);
      }),
    );
  });
});
