'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AccountAccessNotice, AccountPublicLeagues, type AccountAvailability } from './account-access';
import { announceAccountSessionChange } from './account-client';
import { accountRecovery } from './account-recovery';
import styles from './account.module.css';

export function AccountSignIn({ availability }: { availability: AccountAvailability }) {
  const router = useRouter();
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'verify' | 'recover' | 'reset'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const resetToken = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const recovery = accountRecovery(window.location.search);
    if (recovery.kind === 'none') return;
    // The route's no-referrer response header protects initial navigation. Remove
    // the one-time secret from history before any user action or SDK request.
    window.history.replaceState(null, '', '/sign-in');
    // A real replacement also clears Next's rendered-search history state; a
    // native URL change alone retains the original server search parameters.
    router.replace('/sign-in', { scroll: false });
    if (recovery.kind === 'reset') {
      resetToken.current = recovery.token;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Capture the external callback after hydration so its secret never becomes server-rendered form state.
      setMode('reset');
    } else {
      setMode('recover'); setFailed(true);
      setMessage('This reset link is invalid or expired. Request a new one.');
    }
  }, [router]);

  function changeMode(next: typeof mode) {
    setMode(next); setPassword(''); setConfirmation(''); setOtp(''); setMessage(''); setFailed(false);
    resetToken.current = null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || availability !== 'available') return;
    if (mode === 'reset' && password !== confirmation) {
      setFailed(true); setMessage('The new passwords do not match.'); return;
    }
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const { accountAuthClient, accountAuthRequest, isAccountEmailUnverified } = await import('@/lib/accounts/auth-client');
      if (!active.current) return;
      const address = email.trim();
      const result = await accountAuthRequest(async () => mode === 'sign-up'
        ? await accountAuthClient.signUp.email({ email: address, password, name: name.trim(), callbackURL: `${window.location.origin}/sign-in` })
        : mode === 'verify'
          ? await accountAuthClient.emailOtp.verifyEmail({ email: address, otp: otp.trim() })
          : mode === 'recover'
            ? await accountAuthClient.requestPasswordReset({ email: address, redirectTo: `${window.location.origin}/sign-in` })
            : mode === 'reset'
              ? await accountAuthClient.resetPassword({ newPassword: password, token: resetToken.current ?? '' })
              : await accountAuthClient.signIn.email({ email: address, password }));
      if (!active.current) return;
      setPassword(''); setConfirmation('');
      if (result.error) {
        if (mode === 'sign-in' && isAccountEmailUnverified(result.error)) {
          changeMode('verify');
          setMessage('Verify your email to sign in. Enter your code below or request another email.');
          return;
        }
        if (mode === 'recover') {
          // Do not distinguish existing, absent, or ineligible email addresses.
          setMessage('If this email can recover an account, check your inbox for a reset link.'); return;
        }
        if (mode === 'reset') {
          resetToken.current = null; setMode('recover'); setFailed(true);
          setMessage('This reset link could not be used. It may be invalid or expired. Request a new one.'); return;
        }
        setFailed(true);
        setMessage(mode === 'verify' ? 'That code could not be verified. Check the code or request another verification email.'
          : mode === 'sign-up' ? 'We could not create this account. Check your details or try signing in.'
            : 'We could not sign you in. Check your email and password. If needed, verify your email first.');
        return;
      }
      if (mode === 'recover') {
        setMessage('If this email can recover an account, check your inbox for a reset link.');
      } else if (mode === 'reset') {
        resetToken.current = null; setMode('sign-in');
        announceAccountSessionChange();
        setMessage('Your password was reset. Sign in with your new password.');
      } else if (mode === 'sign-up') {
        setMode('verify');
        setMessage('Check your email for verification instructions. You can request another message below.');
      } else if (mode === 'verify') {
        setMode('sign-in'); setOtp('');
        setMessage('Email verified. Sign in to continue.');
      } else {
        announceAccountSessionChange();
        window.location.replace('/my-leagues');
      }
    } catch {
      if (active.current) { setPassword(''); setConfirmation(''); setFailed(true); setMessage('Account access is temporarily unavailable. Please try again.'); }
    } finally { if (active.current) setBusy(false); }
  }

  async function resendVerification() {
    if (busy || availability !== 'available') return;
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setFailed(true); setMessage('Enter your email address first.'); return; }
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const { accountAuthClient } = await import('@/lib/accounts/auth-client');
      if (!active.current) return;
      const result = await accountAuthClient.sendVerificationEmail({ email: address, callbackURL: `${window.location.origin}/sign-in` });
      if (!active.current) return;
      if (result.error) throw new Error('Verification unavailable');
      setMode('verify'); setPassword('');
      setMessage('If this account needs verification, check your email for the next step.');
    } catch {
      if (active.current) { setFailed(true); setMessage('We could not send verification instructions. Please try again later.'); }
    } finally { if (active.current) setBusy(false); }
  }

  return <>
    <div className={styles.intro}><h1>{mode === 'sign-up' ? 'Create your account' : mode === 'verify' ? 'Verify your email' : mode === 'recover' ? 'Recover your account' : mode === 'reset' ? 'Reset your password' : 'Sign in'}</h1>
      <p>One website account for your leagues. Your Sleeper password is never needed.</p>
    </div>
    {availability !== 'available' ? <AccountAccessNotice state={availability} /> : <>
      <div className={`${styles.card} ${styles.narrow}`}>
        <p>The account pilot is for invited members. Use your invited email address and verify it before opening your account.</p>
        {message && <p role={failed ? 'alert' : 'status'} className={`${styles.message} ${failed ? styles.error : ''}`}>{message}</p>}
        <form className={styles.form} onSubmit={submit}>
          {mode === 'sign-up' && <label className={styles.field}>Website display name<input autoComplete="nickname" name="name" required maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
          {mode !== 'reset' && <label className={styles.field}>Email<input type="email" autoComplete="email" name="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>}
          {mode === 'verify' ? <label className={styles.field}>Verification code<input name="otp" autoComplete="one-time-code" inputMode="numeric" required maxLength={12} value={otp} disabled={busy} onChange={event => setOtp(event.target.value)} /></label>
            : mode !== 'recover' && <label className={styles.field}>{mode === 'reset' ? 'New website password' : 'Website password'}<input type="password" autoComplete={mode === 'sign-up' || mode === 'reset' ? 'new-password' : 'current-password'} name="password" required minLength={mode === 'sign-up' || mode === 'reset' ? 8 : undefined} maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>}
          {mode === 'reset' && <label className={styles.field}>Confirm new password<input type="password" autoComplete="new-password" name="confirmation" required minLength={8} maxLength={128} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>}
          <div className={styles.actions}><button className={styles.button} type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : mode === 'verify' ? 'Verify code' : mode === 'recover' ? 'Send reset link' : mode === 'reset' ? 'Reset password' : 'Sign in'}</button></div>
        </form>
        {mode === 'verify' && <p>If your message contains a verification link, open it and return here to sign in.</p>}
        <div className={styles.actions}>
          <button className={styles.secondary} type="button" disabled={busy} onClick={() => changeMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>{mode === 'sign-in' ? 'Create an account' : 'Return to sign in'}</button>
          {(mode === 'sign-in' || mode === 'sign-up' || mode === 'verify') && <button className={styles.secondary} type="button" disabled={busy} onClick={() => { void resendVerification(); }}>Send verification email</button>}
          {mode === 'sign-in' && <button className={styles.secondary} type="button" disabled={busy} onClick={() => changeMode('verify')}>I have a verification code</button>}
          {mode === 'sign-in' && <button className={styles.secondary} type="button" disabled={busy} onClick={() => changeMode('recover')}>Forgot password?</button>}
        </div>
      </div>
      <AccountPublicLeagues />
    </>}
  </>;
}
