/**
 * realtls — perform TLS 1.3 + HTTP/2 exactly like a real Chrome browser, from Node/TS,
 * so `fetch()` reaches servers that classify clients by TLS/HTTP fingerprint (JA3/JA4).
 *
 * NOTE: the live `fetch` integration (undici dispatcher + handshake engine) is under
 * active construction. What is exported today is the fully-tested fingerprint core:
 * the Chrome profile, the byte-exact ClientHello builder, and JA3/JA4 computation.
 */
export type { TlsProfile, Http2Profile } from './profiles/types.js';
export { chrome151 } from './profiles/chrome.js';

export {
    buildClientHello,
    parseClientHello,
    type ClientHelloParams,
    type ParsedClientHello,
    type KeyShareEntry,
} from './tls/clienthello.js';

export { ja4, ja4Raw, ja3 } from './tls/ja4.js';
export { RecordProtection, plaintextRecord, readRecord, type RawRecord } from './tls/record.js';

export { parseServerHello, type ParsedServerHello, type ServerKeyShare } from './tls/serverhello.js';
export { generateKeyShare, generateKeyShares, x25519SharedSecret, type KeyShare } from './tls/keyexchange.js';

export {
    KeySchedule,
    cipherParams,
    hkdfExtract,
    hkdfExpandLabel,
    deriveSecret,
    transcriptHash,
    trafficKeyIv,
    finishedKey,
    finishedVerifyData,
    type CipherParams,
    type AeadId,
} from './tls/keyschedule.js';
export { generateGrease, isGrease, GREASE_VALUES, type GreaseValues } from './tls/grease.js';
export { ByteWriter, ByteReader, hex, fromHex, concatBytes } from './util/bytes.js';
export { nonNull } from './util/assert.js';
