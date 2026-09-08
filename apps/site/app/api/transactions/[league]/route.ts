import { handleLeagueTransactionsRequest } from '@/lib/league-transactions-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ league: string }> },
): Promise<Response> {
  const { league } = await params;
  return handleLeagueTransactionsRequest(league);
}
