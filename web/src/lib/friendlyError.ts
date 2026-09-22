// Turns technical database, auth and network messages into plain language.
// Messages the app raises on purpose are already readable and pass through unchanged.
const RULES: [RegExp, string][] = [
  [/failed to fetch|networkerror|load failed|network request failed/i, "Can't reach the server. Check your connection and try again."],
  [/jwt expired|invalid jwt|refresh token|session.*(missing|expired)/i, 'Your session has expired. Please sign in again.'],
  [/invalid login credentials/i, 'Email or password is incorrect.'],
  [/email not confirmed/i, 'Please confirm your email first. Check your inbox for the link.'],
  [/rate limit|too many requests|over_request_rate_limit/i, 'Too many attempts. Please wait a minute and try again.'],
  [/row-level security|permission denied|insufficient_privilege/i, "You don't have permission to do that."],
  [/duplicate key|unique constraint|already exists/i, 'That has already been added.'],
  [/violates not-null/i, 'Please fill in all the required fields.'],
  [/violates foreign key/i, 'That item is no longer available. Please refresh the page.'],
  [/violates check constraint/i, "Some details aren't valid. Please check the form and try again."],
  [/value too long/i, 'Some of the text is too long. Please shorten it.'],
  [/invalid input syntax|invalid input value/i, "Some details aren't in the right format."],
  [/canceling statement|statement timeout|timed out/i, 'That took too long. Please try again.'],
  [/payload too large|entity too large|exceeded the maximum allowed size/i, 'That file is too large.'],
];

export function friendlyError(message: string | null | undefined): string {
  if (!message) return 'Something went wrong. Please try again.';
  for (const [re, text] of RULES) if (re.test(message)) return text;
  return message;
}
