import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SITE_LOGO } from '../lib/leagues';

const siteDir = fileURLToPath(new URL('..', import.meta.url));
const sourcePath = resolve(siteDir, 'public', SITE_LOGO.slice(1));
const source = readFileSync(sourcePath);
const sourceHash = createHash('sha256').update(source).digest('hex');

// Exercise the installed dependency, its real static-file stream and its real
// coalescer. A child bounds the known unresolved-promise failure without leaving
// a stuck dependency operation in the Vitest worker. No application server,
// provider request, production fixture route or image-cache warm-up is needed.
// Upstream fix: https://github.com/vercel/next.js/pull/98168
const probe = String.raw`
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { basename, dirname } = require('node:path');
const { Batcher } = require('next/dist/lib/batcher');
const { fetchInternalImage } = require('next/dist/server/image-optimizer');
const { serveStatic } = require('next/dist/server/serve-static');
const [method, timing, sourcePath] = process.argv.slice(1);
const deadline = setTimeout(() => {
  process.stderr.write('Internal image fetch did not settle after requester disconnect (' + method + ', ' + timing + ').\n');
  process.exit(1);
}, 5_000);

async function run() {
  const requester = Object.assign(new EventEmitter(), {
    writable: timing !== 'before', destroyed: timing === 'before',
    encrypted: true, remoteAddress: '192.0.2.42',
  });
  let calls = 0;
  let disconnectedAtBytes = 0;
  let observedRequest;
  const handleRequest = (req, res) => {
    calls += 1;
    observedRequest = {
      method: req.method,
      sameSocket: req.socket === requester,
      encrypted: req.socket.encrypted,
      remoteAddress: req.socket.remoteAddress,
    };
    if (timing === 'during') {
      // Observe the first real file chunk after it has been piped to the real
      // mocked response. Only the requester's connection changes; the response,
      // file stream, completion events and returned bytes are never replaced.
      res.once('pipe', stream => stream.once('data', chunk => {
        disconnectedAtBytes = chunk.length;
        requester.writable = false;
        requester.destroyed = true;
        requester.emit('close');
      }));
    }
    return serveStatic(req, res, basename(sourcePath), { root: dirname(sourcePath) });
  };
  const batcher = Batcher.create();
  const consumers = Array.from({ length: 10 }, () => batcher.batch('cold-logo', () =>
    fetchInternalImage('/' + basename(sourcePath), { method, socket: requester }, {},
      300_000_000, handleRequest)));
  const results = await Promise.all(consumers);
  return {
    calls, observedRequest, disconnectedAtBytes,
    requesterDisconnected: !requester.writable && requester.destroyed,
    results: results.map(result => ({
      bytes: result.buffer.length,
      hash: createHash('sha256').update(result.buffer).digest('hex'),
      contentType: result.contentType,
    })),
  };
}

run().then(result => {
  clearTimeout(deadline);
  process.stdout.write(JSON.stringify(result));
}, error => {
  clearTimeout(deadline);
  process.stderr.write(String(error.stack || error));
  process.exitCode = 1;
});
`;

type ProbeResult = {
  calls: number;
  observedRequest: { method: string; sameSocket: boolean; encrypted: boolean; remoteAddress: string };
  disconnectedAtBytes: number;
  requesterDisconnected: boolean;
  results: { bytes: number; hash: string; contentType: string }[];
};

function runProbe(method: 'GET' | 'HEAD', timing: 'before' | 'during'): Promise<ProbeResult> {
  return new Promise((resolveProbe, reject) => {
    execFile(process.execPath, ['--input-type=commonjs', '--eval', probe, method, timing, sourcePath], {
      cwd: siteDir, encoding: 'utf8', timeout: 10_000, windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`Next image abort regression failed: ${stderr.trim() || error.message}`));
      try { resolveProbe(JSON.parse(stdout) as ProbeResult); } catch (parseError) { reject(parseError); }
    });
  });
}

describe('Next internal image fetch after requester disconnect', () => {
  for (const method of ['GET', 'HEAD'] as const) {
    for (const timing of ['before', 'during'] as const) {
      it(`completes all ten coalesced ${method} consumers when the requester disconnects ${timing} streaming`, async () => {
        const result = await runProbe(method, timing);
        expect(result.calls).toBe(1);
        expect(result.requesterDisconnected).toBe(true);
        expect(result.observedRequest).toEqual({
          method: 'GET', sameSocket: true, encrypted: true, remoteAddress: '192.0.2.42',
        });
        expect(result.results).toHaveLength(10);
        for (const image of result.results) {
          expect(image).toEqual({ bytes: source.length, hash: sourceHash, contentType: 'image/png' });
        }
        if (timing === 'during') {
          expect(result.disconnectedAtBytes).toBeGreaterThan(0);
          expect(result.disconnectedAtBytes).toBeLessThan(source.length);
        } else {
          expect(result.disconnectedAtBytes).toBe(0);
        }
      }, 15_000);
    }
  }
});
