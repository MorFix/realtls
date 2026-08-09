import type { TlsProfile } from './types.js';
import { NamedGroup, TLS_VERSION } from '../tls/constants.js';

/**
 * Chrome 151 on macOS. Captured 2026-08-09 from a real browser via chrome-devtools
 * (tls.peet.ws/api/all) cross-checked with a raw tcpdump of the www.metacareers.com
 * handshake. See AGENTS.md and tests/fixtures/chrome151-fingerprint.json.
 *
 *   JA4  = t13d1516h2_8daaf6152771_806a8c22fdea
 *   H2   = 1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p
 */
export const chrome151: TlsProfile = {
    name: 'chrome-151',
    userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',

    recordVersion: TLS_VERSION.TLS10,
    handshakeVersion: TLS_VERSION.TLS12,

    cipherSuites: [
        0x1301,
        0x1302,
        0x1303, // TLS 1.3 AEADs
        0xc02b,
        0xc02f,
        0xc02c,
        0xc030, // ECDHE ECDSA/RSA AES-GCM
        0xcca9,
        0xcca8, // ECDHE ChaCha20-Poly1305
        0xc013,
        0xc014, // ECDHE AES-CBC
        0x009c,
        0x009d, // RSA AES-GCM
        0x002f,
        0x0035, // RSA AES-CBC
    ],

    supportedGroups: [NamedGroup.X25519MLKEM768, NamedGroup.X25519, NamedGroup.secp256r1, NamedGroup.secp384r1],

    // Only the hybrid PQ group and X25519 get a real key_share (plus a 1-byte GREASE share).
    keyShareGroups: [NamedGroup.X25519MLKEM768, NamedGroup.X25519],

    signatureAlgorithms: [
        0x0904,
        0x0905,
        0x0906, // Chrome 151 additions
        0x0403, // ecdsa_secp256r1_sha256
        0x0804, // rsa_pss_rsae_sha256
        0x0401, // rsa_pkcs1_sha256
        0x0503, // ecdsa_secp384r1_sha384
        0x0805, // rsa_pss_rsae_sha384
        0x0501, // rsa_pkcs1_sha384
        0x0806, // rsa_pss_rsae_sha512
        0x0601, // rsa_pkcs1_sha512
    ],

    supportedVersions: [TLS_VERSION.TLS13, TLS_VERSION.TLS12],

    alpn: ['h2', 'http/1.1'],
    alps: ['h2'],
    certCompressionAlgorithms: [2], // brotli
    ecPointFormats: [0], // uncompressed
    pskKeyExchangeModes: [1], // psk_dhe_ke

    greaseExtensions: true,
    echGrease: true,
    permuteExtensions: true,

    defaultHeaders: {
        'sec-ch-ua': '"Chromium";v="151", "Not.A/Brand";v="24", "Google Chrome";v="151"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'upgrade-insecure-requests': '1',
        'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'sec-fetch-site': 'none',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-user': '?1',
        'sec-fetch-dest': 'document',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9',
        priority: 'u=0, i',
    },

    h2: {
        settings: [
            [0x1, 65536], // HEADER_TABLE_SIZE
            [0x2, 0], // ENABLE_PUSH
            [0x4, 6291456], // INITIAL_WINDOW_SIZE
            [0x6, 262144], // MAX_HEADER_LIST_SIZE
        ],
        windowUpdateIncrement: 15663105,
        pseudoHeaderOrder: [':method', ':authority', ':scheme', ':path'],
        headerOrder: [
            'upgrade-insecure-requests',
            'user-agent',
            'accept',
            'sec-fetch-site',
            'sec-fetch-mode',
            'sec-fetch-user',
            'sec-fetch-dest',
            'accept-encoding',
            'accept-language',
            'priority',
        ],
        headersPriority: { weight: 256, dependsOn: 0, exclusive: true },
    },
};
