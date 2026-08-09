/** TLS numeric constants used across the record/handshake layers. */

export const TLS_VERSION = {
    TLS10: 0x0301,
    TLS12: 0x0303,
    TLS13: 0x0304,
} as const;

export const ContentType = {
    ChangeCipherSpec: 20,
    Alert: 21,
    Handshake: 22,
    ApplicationData: 23,
} as const;

export const HandshakeType = {
    ClientHello: 1,
    ServerHello: 2,
    NewSessionTicket: 4,
    EncryptedExtensions: 8,
    Certificate: 11,
    CertificateRequest: 13,
    CertificateVerify: 15,
    Finished: 20,
} as const;

/** TLS ExtensionType registry (subset Chrome uses). */
export const ExtensionType = {
    server_name: 0,
    status_request: 5,
    supported_groups: 10,
    ec_point_formats: 11,
    signature_algorithms: 13,
    application_layer_protocol_negotiation: 16,
    signed_certificate_timestamp: 18,
    extended_master_secret: 23,
    compress_certificate: 27,
    session_ticket: 35,
    supported_versions: 43,
    psk_key_exchange_modes: 45,
    key_share: 51,
    application_settings: 17613, // ALPS
    encrypted_client_hello: 65037,
    renegotiation_info: 65281,
} as const;

/** NamedGroup registry (subset). */
export const NamedGroup = {
    X25519MLKEM768: 0x11ec, // 4588 — hybrid post-quantum, Chrome's first key_share
    X25519: 0x001d, // 29
    secp256r1: 0x0017, // 23 (P-256)
    secp384r1: 0x0018, // 24 (P-384)
} as const;

export const CipherSuite = {
    TLS_AES_128_GCM_SHA256: 0x1301,
    TLS_AES_256_GCM_SHA384: 0x1302,
    TLS_CHACHA20_POLY1305_SHA256: 0x1303,
} as const;
