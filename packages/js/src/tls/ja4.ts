import { sha256 } from '@noble/hashes/sha2.js';
import { md5 } from '@noble/hashes/legacy.js';
import { isGrease } from './grease.js';
import { hex } from '../util/bytes.js';
import { nonNull } from '../util/assert.js';
import type { ParsedClientHello } from './clienthello.js';
import { ExtensionType } from './constants.js';

function hex4(n: number): string {
    return n.toString(16).padStart(4, '0');
}

function sha256Hex12(s: string): string {
    return hex(sha256(new TextEncoder().encode(s)).subarray(0, 6));
}

function md5Hex(s: string): string {
    return hex(md5(new TextEncoder().encode(s)));
}

/** First+last character of the first ALPN value, e.g. "h2" -> "h2", "http/1.1" -> "h1". */
function alpnMarker(alpn: string[]): string {
    const first = alpn.find((a) => a.length > 0);
    return first ? first.slice(0, 1) + first.slice(-1) : '00';
}

const TLS_VERSION_LABEL: Record<number, string> = {
    0x0304: '13',
    0x0303: '12',
    0x0302: '11',
    0x0301: '10',
};

/**
 * Compute JA4 (Foxio) for a ClientHello. JA4 is deliberately order-invariant: it sorts
 * cipher suites and extensions before hashing, so it is stable across Chrome's
 * per-connection extension shuffle — which is exactly why we target it.
 *
 * Format: t{ver}{d|i}{ciphers}{exts}{alpn}_{sha256(ciphers)[:12]}_{sha256(exts_sigalgs)[:12]}
 */
export function ja4(ch: ParsedClientHello, transport: 't' | 'q' = 't'): string {
    const ciphers = ch.cipherSuites.filter((c) => !isGrease(c));
    const extsNoGrease = ch.extensions.map((e) => e.type).filter((t) => !isGrease(t));

    // ja4_a
    const highestVersion = ch.supportedVersions.filter((v) => !isGrease(v)).sort((a, b) => b - a)[0];
    const ver = TLS_VERSION_LABEL[highestVersion ?? ch.legacyVersion] ?? '00';
    const sni = ch.serverName ? 'd' : 'i';
    const cc = String(Math.min(ciphers.length, 99)).padStart(2, '0');
    const ec = String(Math.min(extsNoGrease.length, 99)).padStart(2, '0');
    const alpn = alpnMarker(ch.alpn);
    const ja4a = `${transport}${ver}${sni}${cc}${ec}${alpn}`;

    // ja4_b — sorted cipher suites
    const ja4b = sha256Hex12(ciphers.map(hex4).sort().join(','));

    // ja4_c — sorted extensions (excluding SNI + ALPN) then signature algorithms in order
    const extsForHash = extsNoGrease
        .filter((t) => t !== ExtensionType.server_name && t !== ExtensionType.application_layer_protocol_negotiation)
        .map(hex4)
        .sort();
    const sigalgs = ch.signatureAlgorithms.map(hex4);
    const ja4c = sha256Hex12(`${extsForHash.join(',')}_${sigalgs.join(',')}`);

    return `${ja4a}_${ja4b}_${ja4c}`;
}

/** The raw (pre-hash) JA4 string, handy for debugging and golden tests. */
export function ja4Raw(ch: ParsedClientHello, transport: 't' | 'q' = 't'): string {
    const ciphers = ch.cipherSuites.filter((c) => !isGrease(c));
    const extsNoGrease = ch.extensions.map((e) => e.type).filter((t) => !isGrease(t));
    const highestVersion = ch.supportedVersions.filter((v) => !isGrease(v)).sort((a, b) => b - a)[0];
    const ver = TLS_VERSION_LABEL[highestVersion ?? ch.legacyVersion] ?? '00';
    const sni = ch.serverName ? 'd' : 'i';
    const cc = String(Math.min(ciphers.length, 99)).padStart(2, '0');
    const ec = String(Math.min(extsNoGrease.length, 99)).padStart(2, '0');
    const alpn = alpnMarker(ch.alpn);
    const sortedCiphers = ciphers.map(hex4).sort().join(',');
    const sortedExts = extsNoGrease
        .filter((t) => t !== ExtensionType.server_name && t !== ExtensionType.application_layer_protocol_negotiation)
        .map(hex4)
        .sort()
        .join(',');
    const sigalgs = ch.signatureAlgorithms.map(hex4).join(',');
    return `${transport}${ver}${sni}${cc}${ec}${alpn}_${sortedCiphers}_${sortedExts}_${sigalgs}`;
}

/**
 * Compute JA3 (order-dependent MD5). Provided for completeness/debugging; note that
 * Chrome permutes extensions per-connection, so JA3 is NOT stable for Chrome.
 */
export function ja3(ch: ParsedClientHello): { str: string; hash: string } {
    const ciphers = ch.cipherSuites.filter((c) => !isGrease(c));
    const exts = ch.extensions.map((e) => e.type).filter((t) => !isGrease(t));
    const groups = ch.supportedGroups.filter((g) => !isGrease(g));
    // EC point formats live in ext 11; default Chrome sends [0].
    const pf = ch.extensions.find((e) => e.type === ExtensionType.ec_point_formats);
    const pointFormats: number[] = [];
    if (pf && pf.data.length > 0) {
        const n = nonNull(pf.data[0]);
        for (const b of pf.data.subarray(1, 1 + n)) pointFormats.push(b);
    }
    const version = ch.legacyVersion;
    const str = [version, ciphers.join('-'), exts.join('-'), groups.join('-'), pointFormats.join('-')].join(',');
    return { str, hash: md5Hex(str) };
}
