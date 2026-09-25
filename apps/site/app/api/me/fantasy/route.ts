import { accountFantasyResponse } from '@/lib/accounts/fantasy';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) { return accountFantasyResponse(request); }
