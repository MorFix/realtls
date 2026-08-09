import { loadTlsClient } from './loader.js';

/** Request payload accepted by tls-client's `request` C function (subset we use). */
export interface NativeRequest {
    tlsClientIdentifier: string;
    requestUrl: string;
    requestMethod: string;
    headers: Record<string, string>;
    headerOrder?: string[];
    requestBody?: string;
    followRedirects?: boolean;
    insecureSkipVerify?: boolean;
    isByteResponse?: boolean;
    timeoutSeconds?: number;
}

/** Response JSON returned by tls-client's `request`. */
export interface NativeResponse {
    id: string;
    status: number;
    target: string;
    body: string; // base64 when isByteResponse=true
    headers: Record<string, string[] | string>;
}

/** Issue one request through the native uTLS client and free its native buffer. */
export async function nativeRequest(req: NativeRequest): Promise<NativeResponse> {
    const lib = await loadTlsClient();
    const raw = lib.request(JSON.stringify(req));
    const parsed = JSON.parse(raw) as NativeResponse;
    if (parsed.id) lib.freeMemory(parsed.id);
    return parsed;
}
