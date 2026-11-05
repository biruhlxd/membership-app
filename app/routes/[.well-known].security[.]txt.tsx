// /.well-known/security.txt (RFC 9116): where to report a security problem.
// Renew the Expires date every year (see docs/SECURITY.md).
const SECURITY_TXT = `Contact: mailto:biruh@biruh.org
Expires: 2027-11-06T00:00:00.000Z
Preferred-Languages: en
Policy: https://app.biruh.org/terms#dpa
Canonical: https://app.biruh.org/.well-known/security.txt
`;

export const loader = () =>
  new Response(SECURITY_TXT, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
