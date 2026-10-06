import 'server-only';

/** Syntax/credential transport validation only. Actual server identity and LOGIN
 * privileges must independently be checked in the operation's transaction. */
export function restrictedNeonUrl(raw: string | undefined, expectedRole: string): string | null {
  try {
    const url = new URL(raw ?? '');
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !url.hostname.endsWith('.neon.tech') || !url.hostname.startsWith('ep-') || !url.password
      || decodeURIComponent(url.username) !== expectedRole
      || !database || database.length > 63 || /[\/\\\u0000-\u001f]/u.test(database)
      || url.hash || (url.port && url.port !== '5432')
      || !['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')
      || url.searchParams.getAll('sslmode').length !== 1
      || [...url.searchParams.keys()].some(key => !['sslmode', 'channel_binding'].includes(key))
      || url.searchParams.getAll('channel_binding').length > 1
      || (url.searchParams.has('channel_binding') && url.searchParams.get('channel_binding') !== 'require')) return null;
    return url.toString();
  } catch { return null; }
}
