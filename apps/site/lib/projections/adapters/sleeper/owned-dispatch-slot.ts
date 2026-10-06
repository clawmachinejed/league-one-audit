import 'server-only';

import { request } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import type { SleeperDispatchSlot } from './permit-transport';

/** Concrete local resource owner for the permit transport; deliberately not
 * wired to existing callsites until global admission/callsite qualification.
 * The caller already owns one capacity reservation. An exclusive nonpooled
 * connection prevents destroying or releasing another request's capacity.
 * onRelease must return that reservation, not create/refund a SQL permit.
 * A slot that never acknowledges close remains unavailable to its pool.
 */
export function createOwnedSleeperDispatchSlot(onRelease: () => void): SleeperDispatchSlot {
  let started = false;
  let terminating = false;
  let released = false;
  let outgoing: ClientRequest | undefined;
  let incoming: IncomingMessage | undefined;
  let socket: Socket | undefined;
  let requestClosed = false;
  let responseClosed = false;
  let socketClosed = false;
  let confirm!: (result: 'terminated') => void;
  const closure = new Promise<'terminated'>((resolve) => { confirm = resolve; });
  const checkClosure = () => {
    if (requestClosed && (!incoming || responseClosed) && (!socket || socketClosed)) confirm('terminated');
  };
  return {
    dispatch(url, init) {
      if (started || released || terminating) throw new Error('Local dispatch slot is not available');
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['api.sleeper.app', 'api.sleeper.com'].includes(parsed.hostname)
        || parsed.port || parsed.username || parsed.password || parsed.hash
        || init.method !== 'GET' || init.redirect !== 'manual' || init.cache !== 'no-store'
        || init.body != null) throw new Error('Local dispatch scope refused');
      started = true;
      return new Promise<Response>((resolve, reject) => {
        // No pooling, redirect handling, retry, framework cache or post-grant
        // queue. The request is started in this synchronous dispatch invocation.
        outgoing = request(parsed, { method: 'GET', agent: false,
          headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
          signal: init.signal ?? undefined }, (response) => {
          incoming = response;
          response.once('close', () => { responseClosed = true; checkClosure(); });
          if (terminating) { response.destroy(); return; }
          try {
            const headers = new Headers();
            for (const [key, value] of Object.entries(response.headers)) {
              if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
              else if (value !== undefined) headers.set(key, value);
            }
            // Identity encoding is requested; an unexpected encoded response
            // cannot masquerade as decoded source bytes.
            const encoded = headers.has('content-encoding') && headers.get('content-encoding') !== 'identity';
            const status = response.statusCode ?? 0;
            const body = [204, 205, 304].includes(status) ? null
              : encoded ? new ReadableStream<Uint8Array>({ start(controller) {
                controller.error(new Error('Unexpected response encoding'));
              } }) : Readable.toWeb(response) as ReadableStream<Uint8Array>;
            // Preserve status/Retry-After even when body representation fails.
            if (encoded) response.destroy();
            if (body === null) response.resume();
            resolve(new Response(body, { status, headers }));
          } catch (error) { response.destroy(); reject(error); }
        });
        outgoing.once('socket', (ownedSocket) => {
          socket = ownedSocket;
          socket.once('close', () => { socketClosed = true; checkClosure(); });
          if (terminating) socket.destroy();
        });
        outgoing.once('close', () => { requestClosed = true; checkClosure(); });
        outgoing.once('error', reject);
        outgoing.end();
      });
    },
    terminateLocal() {
      terminating = true;
      // destroy() initiates termination; only close events above prove it. A
      // synchronous exception or missing close event cannot acknowledge release.
      let failed = false;
      for (const resource of [incoming, outgoing, socket]) {
        try { resource?.destroy(); } catch { failed = true; }
      }
      if (failed) return Promise.resolve('unconfirmed');
      if (!started) return Promise.resolve('terminated');
      if (!outgoing) return Promise.resolve('unconfirmed');
      checkClosure();
      return closure;
    },
    release() {
      if (released) return;
      if (started && (!requestClosed || (incoming && !responseClosed) || (socket && !socketClosed))) {
        throw new Error('Local dispatch closure is unconfirmed');
      }
      released = true;
      onRelease();
    },
  };
}
