import { EventEmitter } from 'node:events';
import { createServer, request as loopbackRequest } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request }));
import { createOwnedSleeperDispatchSlot } from './owned-dispatch-slot';

const init: RequestInit = { method: 'GET', cache: 'no-store', redirect: 'manual' };
function setup() {
  const outgoing = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  request.mockReturnValue(outgoing);
  const release = vi.fn();
  const slot = createOwnedSleeperDispatchSlot(release);
  return { outgoing, socket, release, slot };
}
afterEach(() => vi.clearAllMocks());

describe('exclusive local Sleeper dispatch owner', () => {
  it.each(['headers', 'body'])('closes a real exclusively owned loopback socket stalled before %s completion', async (phase) => {
    // Only the HTTPS factory is redirected to a local HTTP test server. The
    // owner and real ClientRequest/IncomingMessage/socket lifecycle are intact.
    const sockets = new Set<Socket>();
    const server = createServer((_request, response) => {
      if (phase === 'body') { response.writeHead(200); response.write('unfinished'); }
    });
    server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    let clientSocket: Socket | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing loopback listener');
      let connected!: () => void;
      const connection = new Promise<void>((resolve) => { connected = resolve; });
      let observedClientClose = false;
      request.mockImplementation((_url, options, listener) => {
        const outgoing = loopbackRequest({ ...options, host: '127.0.0.1', port: address.port, path: '/' }, listener);
        outgoing.on('socket', (socket) => {
          clientSocket = socket;
          socket.on('connect', connected);
          socket.on('close', () => { observedClientClose = true; });
        });
        return outgoing;
      });
      const released = vi.fn();
      const slot = createOwnedSleeperDispatchSlot(released);
      const response = slot.dispatch('https://api.sleeper.app/v1/state/nfl', init).catch(() => null);
      const exercise = async () => {
        await connection;
        if (phase === 'body') expect(await response).toBeInstanceOf(Response);
        expect(observedClientClose).toBe(false);
        expect(await slot.terminateLocal()).toBe('terminated');
        expect(observedClientClose).toBe(true);
        expect(clientSocket?.destroyed).toBe(true);
        slot.release();
        expect(released).toHaveBeenCalledTimes(1);
      };
      await Promise.race([exercise(), new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Local closure test exceeded one second')), 1000);
      })]);
    } finally {
      clearTimeout(timeout);
      clientSocket?.destroy();
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => { server.close(() => resolve()); });
    }
  });

  it('starts one unpooled request synchronously and never retries or redispatches', () => {
    const s = setup();
    void s.slot.dispatch('https://api.sleeper.app/v1/state/nfl', init);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({ agent: false, method: 'GET' });
    expect(s.outgoing.end).toHaveBeenCalledTimes(1);
    expect(() => s.slot.dispatch('https://api.sleeper.app/v1/state/nfl', init)).toThrow();
    expect(() => s.slot.release()).toThrow('closure is unconfirmed');
    expect(s.release).not.toHaveBeenCalled();
  });

  it('destroy initiates termination but requires request AND socket close before reuse', async () => {
    const s = setup();
    void s.slot.dispatch('https://api.sleeper.app/v1/state/nfl', init);
    s.outgoing.emit('socket', s.socket);
    const closed = vi.fn();
    const teardown = s.slot.terminateLocal().then(closed);
    expect(s.socket.destroy).toHaveBeenCalledTimes(1);
    expect(s.outgoing.destroy).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
    s.outgoing.emit('close');
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
    expect(() => s.slot.release()).toThrow();
    s.socket.emit('close');
    await teardown;
    expect(closed).toHaveBeenCalledWith('terminated');
    s.slot.release();
    s.slot.release();
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it('does not count a destroyed flag or response headers as response closure', async () => {
    const s = setup();
    void s.slot.dispatch('https://api.sleeper.app/v1/state/nfl', init);
    const incoming = Object.assign(new EventEmitter(), { statusCode: 204, headers: {},
      resume: vi.fn(), destroy: vi.fn(), destroyed: true });
    request.mock.calls[0][2](incoming);
    const closed = vi.fn();
    const teardown = s.slot.terminateLocal().then(closed);
    s.outgoing.emit('close');
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
    expect(() => s.slot.release()).toThrow();
    incoming.emit('close');
    await teardown;
    s.slot.release();
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it('destroys a socket assigned during termination and waits for its close', async () => {
    const s = setup();
    void s.slot.dispatch('https://api.sleeper.app/v1/state/nfl', init);
    const closed = vi.fn();
    const teardown = s.slot.terminateLocal().then(closed);
    s.outgoing.emit('socket', s.socket);
    expect(s.socket.destroy).toHaveBeenCalledTimes(1);
    s.outgoing.emit('close');
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
    s.socket.emit('close');
    await teardown;
    expect(closed).toHaveBeenCalledWith('terminated');
  });

  it('does not turn a thrown destroy into confirmation and still tries other owned resources', async () => {
    const s = setup();
    void s.slot.dispatch('https://api.sleeper.app/v1/state/nfl', init);
    s.outgoing.emit('socket', s.socket);
    s.outgoing.destroy.mockImplementation(() => { throw new Error('destroy failed'); });
    expect(await s.slot.terminateLocal()).toBe('unconfirmed');
    expect(s.socket.destroy).toHaveBeenCalledTimes(1);
    expect(() => s.slot.release()).toThrow();
    expect(s.release).not.toHaveBeenCalled();
  });

  it('can return unused capacity exactly once without opening a connection', () => {
    const s = setup();
    s.slot.release();
    s.slot.release();
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(() => s.slot.dispatch('https://api.sleeper.app/v1/state/nfl', init)).toThrow();
  });

  it.each(['http://api.sleeper.app/v1/state/nfl', 'https://evil.example/v1/state/nfl',
    'https://name:password@api.sleeper.app/v1/state/nfl'])('refuses an unowned endpoint %s', (url) => {
    const s = setup();
    expect(() => s.slot.dispatch(url, init)).toThrow('scope refused');
    expect(request).not.toHaveBeenCalled();
  });
});
