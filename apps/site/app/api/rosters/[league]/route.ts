import { handleLeagueRostersRequest } from '@/lib/league-rosters-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ league: string }> },
): Promise<Response> {
  const { league } = await params;
  return handleLeagueRostersRequest(request, league);
}
