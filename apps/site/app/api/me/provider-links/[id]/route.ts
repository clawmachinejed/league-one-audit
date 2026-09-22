import { accountResponse } from '@/lib/accounts/http';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return accountResponse(request, { kind: 'unlink', id: (await context.params).id });
}
