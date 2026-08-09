import http2 from 'node:http2';
import type { TlsConnection } from '../tls/connection.js';
import type { Http2Profile } from '../profiles/types.js';

export interface H2RequestOptions {
    authority: string;
    method?: string;
    path?: string;
    /** Extra request headers, inserted in order after Chrome's default set. */
    headers?: Record<string, string>;
    profile: Http2Profile;
    body?: Uint8Array;
}

export interface H2Response {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
}

/**
 * Perform one HTTP/2 request over an established TlsConnection, reusing Node's built-in
 * http2 client (so we don't re-implement HPACK/framing) while matching Chrome's SETTINGS
 * and header ordering as closely as the API allows.
 */
export function h2Request(conn: TlsConnection, opts: H2RequestOptions): Promise<H2Response> {
    const settings = Object.fromEntries(opts.profile.settings.map(([id, value]) => [settingName(id), value]));

    return new Promise((resolve, reject) => {
        const session = http2.connect(`https://${opts.authority}`, {
            createConnection: () => conn,
            settings: {
                headerTableSize: settings.headerTableSize,
                enablePush: settings.enablePush === 1,
                initialWindowSize: settings.initialWindowSize,
                maxHeaderListSize: settings.maxHeaderListSize,
            },
        });
        session.on('error', reject);

        // Pseudo-headers first (Chrome order m,a,s,p), then the profile's header order.
        const headers: Record<string, string> = {
            ':method': opts.method ?? 'GET',
            ':authority': opts.authority,
            ':scheme': 'https',
            ':path': opts.path ?? '/',
            ...opts.headers,
        };

        const req = session.request(headers, { endStream: !opts.body });
        let status = 0;
        let respHeaders: Record<string, string | string[] | undefined> = {};
        const chunks: Buffer[] = [];

        req.on('response', (h) => {
            status = Number(h[':status'] ?? 0);
            respHeaders = h;
        });
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            resolve({ status, headers: respHeaders, body: Buffer.concat(chunks) });
            session.close();
        });
        req.on('error', reject);

        if (opts.body) req.end(Buffer.from(opts.body));
        else req.end();
    });
}

function settingName(id: number): string {
    switch (id) {
        case 0x1:
            return 'headerTableSize';
        case 0x2:
            return 'enablePush';
        case 0x4:
            return 'initialWindowSize';
        case 0x6:
            return 'maxHeaderListSize';
        default:
            return `setting_${id}`;
    }
}
