import 'server-only';

export type AccountEmailConfiguration = { emailApiKey: string; emailFrom: string };
export type AccountEmail = { to: string; subject: string; text: string };

/** Transactional account mail only. Provider responses and secrets never enter logs. */
export async function sendAccountEmail(config: AccountEmailConfiguration, message: AccountEmail): Promise<void> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.emailApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.emailFrom, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Account email delivery failed.');
  } catch {
    throw new Error('Account email delivery is temporarily unavailable.');
  }
}
