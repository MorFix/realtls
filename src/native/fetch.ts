import { chrome151 } from '../profiles/chrome.js';
import type { TlsProfile } from '../profiles/types.js';
import { nativeRequest } from './tlsClient.js';

export interface NativeFetchInit {
    method?: string;
    headers?: Record<string, string>;
    /** Request body as a string (base64 not required; tls-client handles raw). */
    body?: string;
    profile?: TlsProfile;
    followRedirects?: boolean;
    insecureSkipVerify?: boolean;
}

/**
 * fetch() via the native uTLS backend. Unlike the pure engine + undici path, this controls
 * the *exact* HTTP/2 SETTINGS and header order (uTLS ships the browser fingerprint DB), so
 * it is the highest-fidelity option. Returns a standard web `Response`.
 */
export async function nativeFetch(url: string, init: NativeFetchInit = {}): Promise<Response> {
    const profile = init.profile ?? chrome151;
    const headers = { ...(profile.defaultHeaders ?? {}), ...(init.headers ?? {}) };
    const headerOrder = [...profile.h2.pseudoHeaderOrder, ...profile.h2.headerOrder];

    const res = await nativeRequest({
        tlsClientIdentifier: profile.nativeIdentifier ?? 'chrome_133',
        requestUrl: url,
        requestMethod: init.method ?? 'GET',
        headers,
        headerOrder,
        requestBody: init.body ?? '',
        followRedirects: init.followRedirects ?? true,
        insecureSkipVerify: init.insecureSkipVerify ?? false,
        isByteResponse: true,
        timeoutSeconds: 30,
    });

    const bodyBytes = res.body ? Buffer.from(res.body, 'base64') : Buffer.alloc(0);
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(res.headers ?? {})) {
        for (const v of Array.isArray(value) ? value : [value]) responseHeaders.append(name, v);
    }
    return new Response(bodyBytes, { status: res.status, headers: responseHeaders });
}
