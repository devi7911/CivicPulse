import { describe, expect, it } from 'vitest';
import { friendlyError } from './friendlyError';

describe('friendlyError', () => {
  it('rewrites technical messages', () => {
    expect(friendlyError('new row violates row-level security policy for table "events"')).toBe("You don't have permission to do that.");
    expect(friendlyError('TypeError: Failed to fetch')).toMatch(/connection/);
    expect(friendlyError('duplicate key value violates unique constraint "x_pkey"')).toMatch(/already/);
    expect(friendlyError('JWT expired')).toMatch(/sign in again/);
  });
  it('keeps messages the app wrote itself', () => {
    expect(friendlyError('Organisations can publish 5 events every 30 days.')).toBe('Organisations can publish 5 events every 30 days.');
  });
  it('never returns an empty message', () => {
    expect(friendlyError('')).toMatch(/went wrong/);
    expect(friendlyError(null)).toMatch(/went wrong/);
  });
});
