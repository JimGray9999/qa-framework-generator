// Security response headers with a strict CSP (audit M1). In-house rather than `helmet` so it needs
// no new dependency; the header set is small and fixed. The app loads its own bundle and styles,
// Google Fonts, and talks only to this server.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React inline style attributes and the inline <style> in index.html need 'unsafe-inline'.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' http://localhost:3001 http://127.0.0.1:3001",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders() {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.removeHeader('X-Powered-By');
    next();
  };
}
