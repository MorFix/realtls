import type { Socket } from 'node:net';
import type { buildConnector } from 'undici';
import { connect } from '../tls/connection.js';
import type { TlsProfile } from '../profiles/types.js';

export interface ConnectorOptions {
    profile: TlsProfile;
    insecureSkipVerify?: boolean;
}

/**
 * An undici connector that performs our Chrome-faithful TLS 1.3 handshake and hands the
 * resulting connection to undici as the socket. undici then runs HTTP/1.1 or HTTP/2 over
 * it (based on the negotiated ALPN), giving us connection pooling, redirects and response
 * decompression for free — while the fingerprint-bearing TLS bytes are entirely ours.
 */
export function chromeConnector(opts: ConnectorOptions): buildConnector.connector {
    return (options, callback) => {
        const host = options.servername ?? options.hostname;
        const port = Number(options.port) || 443;
        connect({ host, port, profile: opts.profile, insecureSkipVerify: opts.insecureSkipVerify }).then(
            (conn) => callback(null, conn as unknown as Socket),
            (err: unknown) => callback(err as Error, null),
        );
    };
}
