import { sleeperLinkPreviewResponse } from '@/lib/accounts/http';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function GET(request: Request) { return sleeperLinkPreviewResponse(request); }
