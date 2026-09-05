import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Local browser verification requires PORT to be an integer from 1 to 65535.');
}

// Windows can allow a wildcard bind beside a listener on a specific address.
// Probe each local address too, without depending on TCP/HTTP responses.
const hosts = new Set(['127.0.0.1', '::1']);
for (const addresses of Object.values(networkInterfaces())) {
  for (const { address, scopeid } of addresses ?? []) {
    hosts.add(scopeid ? `${address}%${scopeid}` : address);
  }
}
function failure(code) {
  const reason = code === 'EADDRINUSE'
    ? `Local browser port ${port} is occupied`
    : `Cannot prove local browser port ${port} is free (${code})`;
  return new Error(`${reason}; build and browser feature tests were not started.`);
}

// Release probes before the build; Next must still acquire its own listener.
hosts.add('0.0.0.0');
hosts.add('::');
const bindings = [...hosts].map((host) => ({ host, ipv6Only: host.includes(':') }));
// Match Next's default dual-stack binding as well as IPv6-only listeners.
bindings.push({ host: '::', ipv6Only: false });
for (const binding of bindings) {
  const { host } = binding;
  await new Promise((resolve, reject) => {
    const probe = createServer((socket) => socket.destroy());
    probe.once('error', (error) => {
      if (['::1', '::'].includes(host) && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) {
        resolve(); // This OS has no available IPv6 loopback/wildcard binding.
        return;
      }
      reject(failure(error.code));
    });
    probe.listen({ port, ...binding, exclusive: true }, () => {
      probe.close((error) => error ? reject(error) : resolve());
    });
  });
}
