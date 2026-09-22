'use client';
import { ErrorView } from '@/components/error-view';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <ErrorView message="We couldn’t load the league from Sleeper. Your team selection is safe. Please try again." retry={reset} />;
}
