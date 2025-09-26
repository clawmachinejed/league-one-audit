// apps/site/app/owners/layout.tsx

export default function OwnersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Parent /owners layout: no tabs here, so no cross-folder imports.
  // This wraps both /owners and /owners/[id] trees.
  return <>{children}</>;
}
