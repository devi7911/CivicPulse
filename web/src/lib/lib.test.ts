import { describe, expect, it } from 'vitest';
import { FIX_RESPONSE_DAYS, fixState, isOverdue, safeHttps } from './constants';
import { toCsv } from './csv';
import { scrub } from './scrub';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('isOverdue', () => {
  it('flags open reports past the promised date', () => {
    expect(isOverdue({ status: 'progress', target_date: '2000-01-01' })).toBe(true);
    expect(isOverdue({ status: 'pending', target_date: '2999-01-01' })).toBe(false);
  });
  it('never flags finished reports or reports without a date', () => {
    expect(isOverdue({ status: 'resolved', target_date: '2000-01-01' })).toBe(false);
    expect(isOverdue({ status: 'closed', target_date: '2000-01-01' })).toBe(false);
    expect(isOverdue({ status: 'pending', target_date: null })).toBe(false);
  });
});

describe('fixState', () => {
  it('waits for the reporter during the response window', () => {
    expect(fixState({ status: 'resolved', verdict: null, resolved_at: daysAgo(1) })).toBe('waiting');
  });
  it('treats silence after the window as accepted', () => {
    expect(fixState({ status: 'resolved', verdict: null, resolved_at: daysAgo(FIX_RESPONSE_DAYS + 1) })).toBe('auto');
  });
  it('shows confirmation when the reporter accepted', () => {
    expect(fixState({ status: 'resolved', verdict: 'accepted', resolved_at: daysAgo(1) })).toBe('confirmed');
  });
  it('is null for reports that are not resolved', () => {
    expect(fixState({ status: 'progress', verdict: null, resolved_at: null })).toBeNull();
  });
});

describe('safeHttps', () => {
  it('only allows https links', () => {
    expect(safeHttps('https://ghmc.gov.in/x')).toBe('https://ghmc.gov.in/x');
    expect(safeHttps('http://example.com')).toBeNull();
    expect(safeHttps('javascript:alert(1)')).toBeNull();
    expect(safeHttps('not a url')).toBeNull();
    expect(safeHttps(null)).toBeNull();
  });
});

describe('toCsv', () => {
  it('quotes cells and escapes quotes', () => {
    expect(toCsv([{ a: 'x, "y"', b: 1 }])).toBe('a,b\n"x, ""y""","1"');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(toCsv([{ a: '=HYPERLINK("evil")' }])).toBe('a\n"\'=HYPERLINK(""evil"")"');
    expect(toCsv([{ a: '+91 cmd' }, { a: '@SUM(1)' }, { a: '-2' }])).toContain('"\'+91 cmd"');
  });
  it('writes empty cells for null values and nothing for no rows', () => {
    expect(toCsv([{ a: null }])).toBe('a\n""');
    expect(toCsv([])).toBe('');
  });
});

describe('scrub', () => {
  it('removes emails, phone numbers and tokens from error text', () => {
    const out = scrub('failed for ravi@example.com +91 98765 43210 at /x#access_token=abc.def&y=1 eyJhbGci.eyJzdWIi.sig');
    expect(out).not.toMatch(/ravi@|98765|abc\.def|eyJhbGci/);
    expect(out).toContain('[email]');
    expect(out).toContain('[number]');
    expect(out).toContain('[redacted]');
  });
  it('leaves normal messages alone', () => {
    expect(scrub('Cannot read properties of undefined')).toBe('Cannot read properties of undefined');
  });
});
