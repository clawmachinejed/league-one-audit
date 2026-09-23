import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { sendAccountEmail } from './auth-email';

const config = { emailApiKey: 'synthetic-private-mail-key', emailFrom: 'accounts@example.test' };
const message = { to: 'invited@example.test', subject: 'Synthetic subject', text: 'Synthetic account email' };
afterEach(() => { vi.unstubAllGlobals(); });

describe('transactional account email boundary', () => {
  it('sends only to the fixed provider with a bounded request and no redirect following', async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 'synthetic-provider-message' }));
    vi.stubGlobal('fetch', fetchMock);
    await sendAccountEmail(config, message);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { Authorization: `Bearer ${config.emailApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.emailFrom, to: [message.to], subject: message.subject, text: message.text }),
    }));
  });
  it.each([400, 429, 500])('does not expose or log provider details for HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'Synthetic credential-bearing provider detail' }, { status })));
    await expect(sendAccountEmail(config, message)).rejects.toThrow('Account email delivery is temporarily unavailable.');
  });
  it('sanitizes transport and timeout errors without an automatic duplicate send', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('Synthetic private transport detail'); });
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendAccountEmail(config, message)).rejects.toThrow('Account email delivery is temporarily unavailable.');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
