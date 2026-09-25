import { onboardingResponse } from '@/lib/accounts/onboarding-http';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) { return onboardingResponse(request); }
