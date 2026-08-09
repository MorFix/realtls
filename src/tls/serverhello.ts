import { ByteReader, hex } from '../util/bytes.js';
import { ExtensionType, HandshakeType, TLS_VERSION } from './constants.js';

/**
 * Parse a ServerHello handshake message (RFC 8446 §4.1.3). Also recognises a
 * HelloRetryRequest, which is a ServerHello whose random equals a fixed SHA-256 constant.
 */

// SHA-256("HelloRetryRequest") — the sentinel random of a HelloRetryRequest.
const HRR_RANDOM = 'cf21ad74e59a6111be1d8c021e65b891c2a211167abb8c5e079e09e2c8a8339c';

export interface ServerKeyShare {
    group: number;
    keyExchange: Uint8Array;
}

export interface ParsedServerHello {
    legacyVersion: number;
    random: Uint8Array;
    sessionIdEcho: Uint8Array;
    cipherSuite: number;
    /** Negotiated version from supported_versions (0x0304 for TLS 1.3). */
    selectedVersion: number;
    /** Server key_share; null on a HelloRetryRequest (which carries only selected_group). */
    keyShare: ServerKeyShare | null;
    /** selected_group when this is a HelloRetryRequest. */
    selectedGroup: number | null;
    isHelloRetryRequest: boolean;
}

export function parseServerHello(msg: Uint8Array): ParsedServerHello {
    const r = new ByteReader(msg);
    const type = r.u8();
    if (type !== HandshakeType.ServerHello) {
        throw new Error(`not a ServerHello (handshake type ${type})`);
    }
    r.u24(); // body length
    const legacyVersion = r.u16();
    const random = r.bytes(32);
    const sessionIdEcho = r.bytes(r.u8());
    const cipherSuite = r.u16();
    r.u8(); // legacy_compression_method (must be 0)

    const isHelloRetryRequest = hex(random) === HRR_RANDOM;

    let selectedVersion: number = TLS_VERSION.TLS12;
    let keyShare: ServerKeyShare | null = null;
    let selectedGroup: number | null = null;

    if (r.remaining >= 2) {
        const extTotal = r.u16();
        const end = r.offset + extTotal;
        while (r.offset < end) {
            const etype = r.u16();
            const elen = r.u16();
            const data = r.bytes(elen);
            const er = new ByteReader(data);
            switch (etype) {
                case ExtensionType.supported_versions:
                    selectedVersion = er.u16();
                    break;
                case ExtensionType.key_share: {
                    const group = er.u16();
                    if (isHelloRetryRequest) {
                        selectedGroup = group;
                    } else {
                        const keyExchange = er.bytes(er.u16());
                        keyShare = { group, keyExchange };
                    }
                    break;
                }
            }
        }
    }

    return {
        legacyVersion,
        random,
        sessionIdEcho,
        cipherSuite,
        selectedVersion,
        keyShare,
        selectedGroup,
        isHelloRetryRequest,
    };
}
