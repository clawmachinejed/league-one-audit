import { accountResponse } from '@/lib/accounts/http';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return accountResponse(request, { kind: 'save-league', id: (await context.params).id });
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return accountResponse(request, { kind: 'remove-league', id: (await context.params).id });
}
