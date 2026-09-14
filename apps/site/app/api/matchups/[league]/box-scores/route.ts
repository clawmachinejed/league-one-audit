import { handleMatchupBoxScoresRequest } from '@/lib/matchup-box-scores-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ league: string }> },
): Promise<Response> {
  const { league } = await params;
  return handleMatchupBoxScoresRequest(request, league);
}
