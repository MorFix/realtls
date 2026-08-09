import {
    Agent,
    fetch as undiciFetch,
    setGlobalDispatcher,
    type Dispatcher,
    type RequestInit as UndiciRequestInit,
    type Response as UndiciResponse,
} from 'undici';
import { chromeConnector } from './connector.js';
import { chrome151 } from '../profiles/chrome.js';
import type { TlsProfile } from '../profiles/types.js';

export interface ChromeDispatcherOptions {
    /** Browser profile to emulate (default: chrome151). */
    profile?: TlsProfile;
    /** Skip certificate verification. NEVER use in production. */
    insecureSkipVerify?: boolean;
    /** Extra undici Agent options (pool size, keep-alive, etc.). */
    agentOptions?: ConstructorParameters<typeof Agent>[0];
}

/**
 * An undici Dispatcher that speaks Chrome's TLS. Drop it into any fetch call:
 *
 *   fetch(url, { dispatcher: chromeDispatcher() })
 *
 * The TLS handshake is our Chrome-faithful pure-TS engine; undici provides HTTP/1.1+HTTP/2,
 * pooling, redirects and response decompression (gzip/deflate/br/zstd).
 */
export function chromeDispatcher(opts: ChromeDispatcherOptions = {}): Dispatcher {
    const profile = opts.profile ?? chrome151;
    return new Agent({
        ...opts.agentOptions,
        allowH2: true,
        connect: chromeConnector({ profile, insecureSkipVerify: opts.insecureSkipVerify }),
    });
}

export interface RealFetchInit extends UndiciRequestInit {
    profile?: TlsProfile;
}

let sharedDispatcher: Dispatcher | undefined;

function defaultDispatcher(profile: TlsProfile): Dispatcher {
    sharedDispatcher ??= chromeDispatcher({ profile });
    return sharedDispatcher;
}

function headerEntries(h: RealFetchInit['headers']): [string, string][] {
    if (!h) return [];
    if (Array.isArray(h)) return h.map(([k, v]) => [k, String(v)]);
    const iter = h as { entries?: () => IterableIterator<[string, string]> };
    if (typeof iter.entries === 'function') return [...iter.entries()];
    return Object.entries(h as Record<string, string>);
}

/** Merge Chrome's default header *values* under any caller-provided headers. */
function withDefaultHeaders(profile: TlsProfile, init: RealFetchInit): [string, string][] {
    const merged = new Map<string, string>();
    for (const [name, value] of Object.entries(profile.defaultHeaders ?? {})) merged.set(name, value);
    for (const [name, value] of headerEntries(init.headers)) merged.set(name, value);
    return [...merged.entries()];
}

/**
 * A drop-in `fetch` that talks like Chrome: Chrome-faithful TLS via the dispatcher and
 * Chrome's default request headers applied automatically. Uses undici's `fetch` (so the
 * handler and our Agent are the same undici version) and returns a standard `Response`.
 */
export function realFetch(input: string | URL, init: RealFetchInit = {}): Promise<UndiciResponse> {
    const profile = init.profile ?? chrome151;
    const { profile: _profile, ...rest } = init;
    const options: UndiciRequestInit = {
        ...rest,
        headers: withDefaultHeaders(profile, init),
        dispatcher: rest.dispatcher ?? defaultDispatcher(profile),
    };
    return undiciFetch(input, options);
}

let originalFetch: typeof globalThis.fetch | undefined;

/**
 * Replace the global `fetch` so every call talks like Chrome. Idempotent; pair with
 * `uninstall()` to restore. Also sets undici's global dispatcher for `undici.request`.
 */
export function install(opts: ChromeDispatcherOptions = {}): void {
    if (originalFetch) return;
    originalFetch = globalThis.fetch;
    const profile = opts.profile ?? chrome151;
    const dispatcher = chromeDispatcher(opts);
    globalThis.fetch = ((input: string | URL, init?: UndiciRequestInit) =>
        realFetch(input, { ...init, profile, dispatcher })) as unknown as typeof globalThis.fetch;
    setGlobalDispatcher(dispatcher);
}

/** Restore the original global `fetch`. */
export function uninstall(): void {
    if (!originalFetch) return;
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
}
