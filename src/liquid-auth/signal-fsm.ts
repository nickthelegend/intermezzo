export type State = 'idle' | 'ready' | 'processing' | 'closed' | 'error';

export type Event = { type: string; payload?: any };

import * as utils from './utils';
import { fromBase64Url } from '@algorandfoundation/liquid-client';
import { decodeTransaction } from '@algorandfoundation/algokit-utils/transact';
import { Address } from '@algorandfoundation/algokit-utils';

export type SessionContext = any; // keep loose to fit existing session shape

export type ActionFn = (ctx: SessionContext, ev?: Event) => void;

export interface Transition {
  next?: State;
  action?: ActionFn;
}

export class SignalSessionMachine {
  state: State;
  ctx: SessionContext;
  transitions: Record<string, Record<string, Transition>>;

  constructor(initial: State, ctx: SessionContext, transitions: Record<string, Record<string, Transition>>) {
    this.state = initial;
    this.ctx = ctx;
    this.transitions = transitions;
  }

  handle(ev: Event) {
    const table = this.transitions[this.state] || {};
    const t = table[ev.type] || table['*'] || (this.transitions['*'] && this.transitions['*'][ev.type]);
    if (!t) return;
    try {
      if (t.action) t.action(this.ctx, ev);
      if (t.next) this.state = t.next;
    } catch (err) {
      // best-effort: mark error and surface to ctx
      try {
        this.ctx.state = 'error';
      } catch { }
    }
  }
}

// Small helper to create a machine for a session with a basic send-queue and ping handling.
export function createSignalSessionMachine(session: SessionContext) {
  // ensure queue exists
  if (!session.sendQueue) session.sendQueue = [] as any[];

  // Precompute a known test address (Richie) asynchronously and stash on the session.
  // This runs fire-and-forget so the machine creation is synchronous.
  (async () => {
    try {
      const richie_mnemonic =
        'peace blast planet december chalk scheme elbow bicycle horse crunch dad sun veteran under print vendor mammal mail typical discover erosion winter bridge path';
      const root = await utils.createRootKeyFromMnemonic(richie_mnemonic);
      const richieWallet = new utils.HDWalletService(root);
      const key = await richieWallet.generateAlgorandAddressKey(0, 0);
      const addr = utils.encodeAddress(key);
      (session as any).richieAddress = addr;
      // store wallet instance for signing later
      (session as any).richieWallet = richieWallet;
    } catch (e) {
      // don't fail machine creation if derivation fails
    }
  })();

  const sendIfPossible: ActionFn = (ctx) => {
    const dc: any = ctx.dataChannel;
    if (!dc || typeof dc.send !== 'function') return;
    while (ctx.sendQueue && ctx.sendQueue.length) {
      const item = ctx.sendQueue.shift();
      try {
        dc.send(typeof item === 'string' ? item : JSON.stringify(item));
      } catch (e) {
        // On failure, push back and stop flushing.
        ctx.sendQueue.unshift(item);
        break;
      }
    }
  };

  const sendPing: ActionFn = (ctx) => {
    const payload = { type: 'ping', ts: Date.now() };
    const dc: any = ctx.dataChannel;
    if (dc && typeof dc.send === 'function') {
      try {
        dc.send(JSON.stringify(payload));
        ctx.pendingPing = false;
      } catch (e) {
        ctx.pendingPing = true;
        ctx.sendQueue.push(payload);
      }
    } else {
      ctx.pendingPing = true;
      ctx.sendQueue.push(payload);
    }
  };

  // Focused transitions for data-channel protocol only. The machine does NOT
  // manage socket lifecycle or pre/post WebRTC signaling. It assumes the
  // data channel will be attached to `ctx.dataChannel` and will receive
  // `dc-open` / `dc-message` events from the caller.
  const transitions: Record<string, Record<string, Transition>> = {
    // before the data channel is usable
    idle: {
      // peer-resolved may attach a dc prior to open
      'peer-resolved': {
        action: (ctx, ev) => {
          ctx.dataChannel = ev?.payload?.dc ?? ctx.dataChannel;
          // If we already received a link-message (wallet) before the
          // data channel attached, proactively send a ping so the peer
          // knows we're present. Also flush the send queue if the
          // channel is already open.
          try {
            if (ctx.wallet) {
              // enqueue ping (or send) immediately
              sendPing(ctx);
              // enqueue our test address after the ping so tests that
              // assert the first message is a ping remain valid.
              if ((ctx as any).richieAddress) {
                ctx.sendQueue.push({ address: (ctx as any).richieAddress });
              } else {
                // derive address asynchronously and enqueue when ready
                (async () => {
                  try {
                    const addr = await utils.getAddressFromMnemonic(
                      'peace blast planet december chalk scheme elbow bicycle horse crunch dad sun veteran under print vendor mammal mail typical discover erosion winter bridge path',
                    );
                    ctx.sendQueue.push({ address: addr });
                    if (ctx.dataChannel && ctx.dataChannel.readyState === 'open') sendIfPossible(ctx);
                  } catch { }
                })();
              }
            }
            if (ctx.dataChannel && ctx.dataChannel.readyState === 'open') sendIfPossible(ctx);
          } catch { }
        },
      },
      // when the dc becomes open, move to ready and flush queue
      'dc-open': {
        next: 'ready',
        action: (ctx) => {
          sendIfPossible(ctx);
        },
      },
      // link-message is allowed but only updates context
      'link-message': {
        action: (ctx, ev) => {
          ctx.lastActivity = Date.now();
          ctx.wallet = ev?.payload?.wallet ?? ctx.wallet;
        },
      },
    },
    // channel ready to send/receive application protocol messages
    ready: {
      'dc-message': {
        action: (ctx, ev) => {
          ctx.lastActivity = Date.now();
          // parse and dispatch application-level message types
          try {
            const raw = ev?.payload;
            let parsed: any = raw;
            if (typeof raw === 'string') parsed = JSON.parse(raw);
            // handle common types: ping, sign-request, sign-response, etc.
            // Support peers that send a bare bytesToSign object without a `type`.
            // Treat messages containing `bytesToSign` as `sign-request` for convenience.
            const t = parsed?.type ?? (parsed?.bytesToSign ? 'sign-request' : undefined);
            if (!t) return;
            const handler = (readyMessageHandlers as any)[t];
            if (typeof handler === 'function') handler(ctx, { type: t, payload: parsed });
          } catch (e) {
            // ignore parse errors; higher layers can validate
            console.log("error: ", e);
          }
        },
      },
      'dc-open': {
        action: (ctx) => {
          sendIfPossible(ctx);
        },
      },
    },
    // processing: machine is handling a sign-request or similar synchronous flow
    processing: {
      'dc-message': {
        action: (ctx, ev) => {
          ctx.lastActivity = Date.now();
          // remain flexible: reuse ready handlers
          try {
            const raw = ev?.payload;
            let parsed: any = raw;
            if (typeof raw === 'string') parsed = JSON.parse(raw);
            const t = parsed?.type;
            if (!t) return;
            const handler = (readyMessageHandlers as any)[t];
            if (typeof handler === 'function') handler(ctx, { type: t, payload: parsed });
          } catch { }
        },
      },
    },
    error: {
      '*': { action: (ctx) => { } },
    },
    closed: {
      '*': { action: (ctx) => { } },
    },
  };

  // Application-level message handlers used by the machine when in `ready`/`processing`.
  // Keep these small; they may be extended to implement signing flows.
  const readyMessageHandlers: Record<string, ActionFn> = {
    ping: (ctx) => {
      ctx.lastActivity = Date.now();
      const dc: any = ctx.dataChannel;
      const addr = (ctx as any).richieAddress;
      const payload = addr ? { my_address: addr } : { type: 'pong', ts: Date.now() };
      if (dc && typeof dc.send === 'function') {
        try {
          dc.send(JSON.stringify(payload));
        } catch {
          // enqueue on failure
          ctx.sendQueue.push(payload);
        }
      } else {
        // enqueue until the channel is ready
        ctx.sendQueue.push(payload);
      }
    },
    'sign-request': (ctx, ev) => {
      ctx.lastActivity = Date.now();
      const payload = ev?.payload ?? {};
      const id = payload.id;
      // acknowledge receipt immediately
      ctx.sendQueue.push({ type: 'sign-ack', id });

      // Async signing flow: try to sign the provided prefix/tx and enqueue response
      (async () => {
        try {
          const wallet: any = (ctx as any).richieWallet;
          if (!wallet) throw new Error('No wallet available for signing');

          const parsedBytes: Uint8Array = fromBase64Url(payload.bytesToSign)
          const transaction = decodeTransaction(parsedBytes);

          // Only accept `bytesToSign` for now (base64url string or raw bytes)
          let prefix: any = payload.bytesToSign;
          let prefixBytes: Uint8Array;
          if (!prefix) throw new Error('No bytesToSign provided to sign');
          if (typeof prefix === 'string') {
            // base64url string
            prefixBytes = fromBase64Url(prefix);
            try {
              const transaction = decodeTransaction(prefixBytes);

              // 1) fee check
              if (transaction.fee !== 2000n) {
                throw new Error(`Invalid fee: ${String(transaction.fee)}`);
              }

              console.log("Fee is OK, 2000 microAlgo")

              // 2) amount check (for payment transactions)
              const amount = transaction.payment?.amount ?? transaction.amount ?? 0n;
              if (amount !== 0n) {
                throw new Error(`Invalid amount: ${String(amount)}`);
              }

              console.log("Amount is OK, 0 microAlgo")

              // 3) sender check: compare sender against the precomputed `richieAddress`
              const expectedAddr: string | undefined = (ctx as any).richieAddress;
              if (expectedAddr) {
                const senderAddr = utils.encodeAddress(transaction.sender.publicKey as Uint8Array);
                if (senderAddr !== expectedAddr) {
                  throw new Error(`Invalid sender: ${senderAddr} !== ${expectedAddr}`);
                }
              }
            } catch (e) {
              // send failure response and stop
              ctx.sendQueue.push({ type: 'sign-response', id, error: String(e) });
              if (ctx.dataChannel && ctx.dataChannel.readyState === 'open') sendIfPossible(ctx);
              return;
            }
          } else if (prefix instanceof Uint8Array) {
            prefixBytes = prefix;
          } else if (Array.isArray(prefix)) {
            prefixBytes = Uint8Array.from(prefix);
          } else if (Buffer.isBuffer(prefix)) {
            prefixBytes = Uint8Array.from(prefix);
          } else {
            throw new Error('Unsupported bytesToSign format');
          }

          const sig = await wallet.signAlgorandTransaction(0, 0, prefixBytes);
          const sigBuf = Buffer.from(sig);
          const toBase64Url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          const sigB64url = toBase64Url(sigBuf);
          const sig32B64url = toBase64Url(sigBuf.slice(0, 32));
          console.debug('[SignalFSM] signature created', { id, signature32: sig32B64url });
          console.debug('[SignalFSM] enqueueing sign-response', { id, signature32: sig32B64url });
          ctx.sendQueue.push({ type: 'sign-response', id, signature: sigB64url, signature32: sig32B64url });
          if (ctx.dataChannel && ctx.dataChannel.readyState === 'open') sendIfPossible(ctx);
        } catch (e) {
          // signal failure to caller
          ctx.sendQueue.push({ type: 'sign-response', id, error: String(e) });
          if (ctx.dataChannel && ctx.dataChannel.readyState === 'open') sendIfPossible(ctx);
        }
      })();
    },
    'sign-response': (ctx, ev) => {
      ctx.lastActivity = Date.now();
      // store result or pass to waiter
      ctx.lastSignResponse = ev?.payload;
    },
  } as Record<string, ActionFn>;

  // Always start the protocol machine in `idle` so it can accept
  // link-message / peer-resolved events regardless of the external
  // session lifecycle state (which is managed by the caller).
  const m = new SignalSessionMachine('idle', session, transitions);
  return m;
}
