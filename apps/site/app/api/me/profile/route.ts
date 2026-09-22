import { accountResponse } from '@/lib/accounts/http';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function PATCH(request: Request) { return accountResponse(request, { kind: 'profile' }); }
