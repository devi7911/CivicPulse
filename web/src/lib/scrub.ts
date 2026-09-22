// Strip anything that looks like an email, phone number or token before it leaves the device.
export function scrub(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/([?&#](?:access_token|refresh_token|code|token)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, '[number]');
}
