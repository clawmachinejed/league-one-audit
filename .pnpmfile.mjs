// The pinned Neon SDK's UI graph has incompatible ancestor peer providers.
// Supply the exact compatible versions locally without changing package code or
// either UI's better-call requirement. See docs/account-auth-foundation.md.
const providers = {
  '@better-auth/api-key': {
    '@better-auth/core': ['^1.6.23', '1.6.23'],
    'better-call': ['1.3.7', '1.3.7'],
  },
  '@better-auth/passkey': {
    '@better-auth/core': ['^1.6.23', '1.6.23'],
  },
};

export const hooks = {
  readPackage(pkg) {
    const selected = pkg.version === '1.6.23' && Object.hasOwn(providers, pkg.name) ? providers[pkg.name] : undefined;
    if (!selected) return pkg;
    for (const [name, [expectedPeer, version]] of Object.entries(selected)) {
      if (pkg.peerDependencies?.[name] !== expectedPeer || Object.hasOwn(pkg.dependencies ?? {}, name)) {
        throw new Error(`Unexpected published dependency metadata for ${pkg.name}/${name}`);
      }
      pkg.dependencies = { ...pkg.dependencies, [name]: version };
      delete pkg.peerDependencies[name];
    }
    return pkg;
  },
};
