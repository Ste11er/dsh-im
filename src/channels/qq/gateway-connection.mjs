import { installQqConnectionRequests } from './connection-requests.mjs';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { GatewayConnection, GatewayOp, decodeGatewayMessageData } from '@tencent-connect/qqbot-nodejs/protocol';

/** SDK 1.0.4's protocol class sends heartbeats but ignores missing ACKs and
 * exposes no disconnected event through QQBot. Own those two seams here;
 * token refresh, session resume, intents and retry backoff remain SDK-owned.
 */
export class QqGatewayConnection extends GatewayConnection {
  #onState;
  #deadline = null;
  #timeoutMs;
  #awaitingAck = false;
  #health = { state: 'connecting', recovering: true, lastFrameAt: null, lastHeartbeatAt: null,
    lastHeartbeatAckAt: null, heartbeatIntervalMs: null, disconnectReason: null, reconnects: 0,
    phase: 'idle', lastReadyAt: null, lastDisconnect: null, events: [],
    lastDispatchAt: null, dispatchesReceived: 0, lastMessageEventAt: null, messageEventsReceived: 0 };

  constructor(options, { onState = () => {}, connectTimeoutMs = 20_000 } = {}) {
    let request;
    super({ ...options,
      getAccessToken: () => request('token', () => options.getAccessToken()),
      getGatewayUrl: token => request('gateway', () => options.getGatewayUrl(token)),
    });
    this.#onState = onState; this.#timeoutMs = connectTimeoutMs;
    request = async (phase, operation) => {
      this.#publish({ phase });
      try { return await operation(); }
      catch (error) {
        if (!this.isAborted) this.#disconnected(typeof error.code === 'string' ? error.code : `gateway-${phase}-failed`, null,
          { httpStatus: error.httpStatus });
        throw error;
      }
    };
  }
  get health() { return structuredClone(this.#health); }
  #publish(change) {
    const changed = ['state', 'phase', 'disconnectReason'].some(key => Object.hasOwn(change, key) && change[key] !== this.#health[key]);
    Object.assign(this.#health, change);
    if (changed) {
      this.#health.events.push({ at: Date.now(), state: this.#health.state, phase: this.#health.phase, reason: this.#health.disconnectReason });
      this.#health.events = this.#health.events.slice(-32); // Diagnostic retention only; never limits retries.
    }
    this.#onState(this.health);
  }
  #disconnected(reason, closeCode = null, details = {}) {
    const lastDisconnect = { at: Date.now(), reason, closeCode, phase: this.#health.phase, ...details };
    this.#publish({ state: 'reconnecting', recovering: true, disconnectReason: reason, lastDisconnect });
    this.opts.log?.warn?.(`[qq-gateway] ${JSON.stringify(lastDisconnect)}`);
  }
  async start() {
    // SDK start() installs this waiter after await connect(); cancellation during
    // token/discovery would otherwise miss the abort and never finish stopping.
    const signal = this.opts.abortSignal;
    if (signal.aborted) { this.isAborted = true; return; }
    this.restoreSession(); this.registerAbortHandler();
    let stopped;
    const stopping = new Promise(resolve => { stopped = resolve; signal.addEventListener('abort', stopped, { once: true }); });
    try { await this.connect(); await stopping; }
    finally { signal.removeEventListener('abort', stopped); }
  }
  #clearDeadline() { clearTimeout(this.#deadline); this.#deadline = null; }
  #armDeadline(socket, reason) {
    this.#clearDeadline();
    this.#deadline = setTimeout(() => {
      if (this.currentWs !== socket || this.isAborted) return;
      this.#disconnected(reason);
      socket.terminate();
    }, this.#timeoutMs);
    this.#deadline.unref?.();
  }
  async connect() {
    if (this.isConnecting || this.isAborted) return;
    this.#publish({ state: 'connecting', recovering: true, phase: 'token', disconnectReason: null });
    await super.connect();
    const socket = this.currentWs;
    if (!socket) return;
    // SDK close callbacks from retired sockets must not clean up a new socket.
    // Each listener is captured before the new connection can emit events.
    for (const name of ['open', 'message', 'close', 'error']) {
      for (const listener of socket.listeners(name)) {
        socket.removeListener(name, listener);
        socket.on(name, (...args) => { if (this.currentWs === socket) return listener(...args); });
      }
    }
    this.#publish({ phase: 'hello' });
    this.#armDeadline(socket, 'gateway-hello-timeout');
    socket.prependListener('message', data => {
      if (this.currentWs !== socket) return;
      let frame;
      try { frame = JSON.parse(decodeGatewayMessageData(data)); }
      catch { return; } // SDK's parser reports this same invalid network frame.
      const change = { lastFrameAt: Date.now() };
      if (frame.op === GatewayOp.DISPATCH) {
        Object.assign(change, { lastDispatchAt: Date.now(), dispatchesReceived: this.#health.dispatchesReceived + 1 });
        if (['GROUP_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE', 'AT_MESSAGE_CREATE', 'DIRECT_MESSAGE_CREATE'].includes(frame.t)) {
          Object.assign(change, { lastMessageEventAt: Date.now(), messageEventsReceived: this.#health.messageEventsReceived + 1 });
        }
      }
      if (frame.op === GatewayOp.HEARTBEAT_ACK) {
        this.#awaitingAck = false; change.lastHeartbeatAckAt = Date.now();
      }
      if (frame.op === GatewayOp.DISPATCH && ['READY', 'RESUMED'].includes(frame.t)) {
        this.#clearDeadline();
        Object.assign(change, { state: 'connected', recovering: false, phase: 'connected', lastReadyAt: Date.now(), disconnectReason: null });
      }
      if ([GatewayOp.RECONNECT, GatewayOp.INVALID_SESSION].includes(frame.op)) {
        this.#disconnected(frame.op === GatewayOp.INVALID_SESSION ? 'gateway-invalid-session' : 'gateway-server-reconnect');
      }
      this.#publish(change);
    });
    socket.on('error', () => {
      if (this.currentWs === socket && !this.isAborted) this.#disconnected('gateway-socket-error');
    });
  }
  scheduleReconnect(delay) {
    const wasScheduled = Boolean(this.reconnectTimer);
    super.scheduleReconnect(delay);
    if (this.reconnectTimer && !wasScheduled) this.#health.reconnects++;
    if (!this.isAborted) this.#publish({ state: this.reconnectTimer ? 'reconnecting' : 'failed',
      recovering: Boolean(this.reconnectTimer) });
  }
  handleHello(socket, data, accessToken) {
    if (!data || !Number.isFinite(data.heartbeat_interval) || data.heartbeat_interval <= 0) {
      this.#disconnected('gateway-invalid-heartbeat');
      socket.terminate(); return;
    }
    super.handleHello(socket, data, accessToken);
    clearInterval(this.heartbeatInterval);
    this.#awaitingAck = false;
    this.#publish({ heartbeatIntervalMs: data.heartbeat_interval, phase: 'ready' });
    this.#armDeadline(socket, 'gateway-ready-timeout');
    // Give each heartbeat one complete server-advertised interval for its ACK.
    // Quiet groups do not cause reconnects: only a missing protocol ACK does.
    this.heartbeatInterval = setInterval(() => {
      if (this.currentWs !== socket || this.isAborted || socket.readyState !== 1) return;
      if (this.#awaitingAck) {
        this.#disconnected('gateway-heartbeat-timeout');
        socket.terminate(); return;
      }
      this.#awaitingAck = true;
      this.#publish({ lastHeartbeatAt: Date.now() });
      socket.send(JSON.stringify({ op: GatewayOp.HEARTBEAT, d: this.lastSeq }));
    }, data.heartbeat_interval);
    this.heartbeatInterval.unref?.();
  }
  handleClose(code) {
    const reason = this.#health.disconnectReason ?? 'gateway-socket-closed';
    if (!this.isAborted) this.#disconnected(reason, code);
    super.handleClose(code);
    if (!this.isAborted) this.#publish({ state: this.reconnectTimer ? 'reconnecting' : 'failed',
      recovering: Boolean(this.reconnectTimer), disconnectReason: reason });
  }
  cleanup() {
    this.#clearDeadline(); this.#awaitingAck = false;
    super.cleanup();
  }
}

/** Adapter for the pinned QQBot 1.0.4 lifecycle. Its protocol primitives and
 * message middleware remain unchanged; adapt gateway lifecycle and connection HTTP reads.
 */
export class QqConnectedBot extends QQBot {
  constructor(options) {
    super(options);
    installQqConnectionRequests(this);
  }
  async startWebSocket() {
    await this.initToken();
    this.gateway = new QqGatewayConnection({
      account: this.account, abortSignal: this.abortController.signal, log: this.logger,
      userAgent: this.userAgent, intents: this.opts.intents, session: this.opts.sessionPersistence,
      getAccessToken: () => this.tokenManager.getAccessToken(this.creds.appId, this.creds.clientSecret),
      clearTokenCache: () => this.tokenManager.clearCache(this.creds.appId),
      getGatewayUrl: () => this.messageApi.getGatewayUrl(this.creds),
      onReady: data => { void this.emit('ready', data); },
      onResumed: data => { void this.emit('resumed', data); },
      onError: error => { void this.emit('error', error); },
      onMessage: raw => this.handleInboundMessage(raw),
      onInteraction: event => { void this.emit('interaction', { bot: this, event, state: {}, receivedAt: Date.now() }, event); },
      onRawEvent: (eventType, data) => { void this.emit('rawEvent', { bot: this, eventType, data, state: {}, receivedAt: Date.now() }); },
    }, { onState: this.opts.onConnectionState, connectTimeoutMs: this.opts.connectTimeoutMs });
    await this.gateway.start();
  }
}
