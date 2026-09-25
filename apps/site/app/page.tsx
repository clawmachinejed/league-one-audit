import { redirect } from 'next/navigation';
import {
  AccountAdmissionDeniedError,
  AccountAuthUnavailableError,
  getAccountAuthAvailability,
  getAccountPrincipal,
} from '@/lib/accounts/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  if (getAccountAuthAvailability() !== 'available') redirect('/my-fantasy');

  let signedIn = false;
  try {
    signedIn = Boolean(await getAccountPrincipal());
  } catch (error) {
    if (error instanceof AccountAuthUnavailableError) redirect('/my-fantasy');
    if (!(error instanceof AccountAdmissionDeniedError)) throw error;
  }
  redirect(signedIn ? '/my-fantasy' : '/sign-in');
}
