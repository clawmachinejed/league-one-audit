import { handleAccountAuthRequest } from '@/lib/accounts/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export const GET = handleAccountAuthRequest;
export const POST = handleAccountAuthRequest;
