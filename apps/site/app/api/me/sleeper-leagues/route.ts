import { sleeperLeagueDiscoveryResponse } from '@/lib/accounts/http';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) { return sleeperLeagueDiscoveryResponse(request); }
