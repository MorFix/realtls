import { chrome, type NativeProfile } from './profile.js';
import { nativeRequest } from './tlsClient.js';

export interface NativeFetchInit {
    method?: string;
    headers?: Record<string, string>;
    /** Request body as a string. */
    body?: string;
    profile?: NativeProfile;
    followRedirects?: boolean;
    insecureSkipVerify?: boolean;
}

/**
 * fetch() via the native uTLS backend — the highest-fidelity option: uTLS controls the
 * exact TLS *and* HTTP/2 fingerprint (SETTINGS + header order), which the pure-TS + undici
 * path cannot fully reach. Returns a standard web `Response`.
 *
 * We use uTLS's string-response mode, which transparently decompresses the body
 * (gzip/deflate/br/zstd). Binary responses are therefore text-decoded; this backend targets
 * HTML/JSON/text — fetch binary assets via the pure engine if you need byte-exact bodies.
 */
export async function nativeFetch(url: string, init: NativeFetchInit = {}): Promise<Response> {
    const profile = init.profile ?? chrome;
    const headers = { ...profile.defaultHeaders, ...(init.headers ?? {}) };
    const headerOrder = [
        ...profile.headerOrder,
        ...Object.keys(init.headers ?? {}).filter((h) => !(h in profile.defaultHeaders)),
    ];

    const res = await nativeRequest({
        tlsClientIdentifier: profile.identifier,
        requestUrl: url,
        requestMethod: init.method ?? 'GET',
        headers,
        headerOrder,
        requestBody: init.body ?? '',
        followRedirects: init.followRedirects ?? true,
        insecureSkipVerify: init.insecureSkipVerify ?? false,
        isByteResponse: false,
        timeoutSeconds: 30,
    });

    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(res.headers ?? {})) {
        const lower = name.toLowerCase();
        // The body is already decompressed, so drop encoding/length headers.
        if (lower === 'content-encoding' || lower === 'content-length') continue;
        for (const v of Array.isArray(value) ? value : [value]) responseHeaders.append(name, v);
    }
    return new Response(res.body, { status: res.status, headers: responseHeaders });
}
