/** HTTP/2 side of a browser fingerprint (the "Akamai" fingerprint). */
export interface Http2Profile {
    /** SETTINGS frame, in the exact order Chrome sends them. [id, value] pairs. */
    settings: [number, number][];
    /** Connection-level WINDOW_UPDATE increment sent right after SETTINGS. */
    windowUpdateIncrement: number;
    /** Pseudo-header order, e.g. [":method", ":authority", ":scheme", ":path"]. */
    pseudoHeaderOrder: string[];
    /** Default regular-header order for navigations. */
    headerOrder: string[];
    /** Whether the HEADERS frame carries the legacy PRIORITY flag + fields. */
    headersPriority?: { weight: number; dependsOn: number; exclusive: boolean };
}

/** A complete browser TLS+H2 fingerprint profile. GREASE is added by the builder. */
export interface TlsProfile {
    name: string;
    userAgent: string;

    /** TLS record-layer legacy version (0x0301) and handshake legacy version (0x0303). */
    recordVersion: number;
    handshakeVersion: number;

    /** Cipher suites in order, WITHOUT the leading GREASE (builder prepends it). */
    cipherSuites: number[];
    /** Supported groups in order, WITHOUT the leading GREASE. */
    supportedGroups: number[];
    /** Groups we actually generate a key_share for (WITHOUT GREASE), in order. */
    keyShareGroups: number[];
    /** signature_algorithms (ext 13), in order. */
    signatureAlgorithms: number[];
    /** supported_versions (ext 43), WITHOUT GREASE, e.g. [0x0304, 0x0303]. */
    supportedVersions: number[];
    /** ALPN protocol list, e.g. ["h2", "http/1.1"]. */
    alpn: string[];
    /** application_settings (ALPS, ext 17613) protocol list, e.g. ["h2"]. */
    alps: string[];
    /** compress_certificate (ext 27) algorithms, e.g. [2] for brotli. */
    certCompressionAlgorithms: number[];
    /** ec_point_formats (ext 11), e.g. [0]. */
    ecPointFormats: number[];
    /** psk_key_exchange_modes (ext 45), e.g. [1] for psk_dhe_ke. */
    pskKeyExchangeModes: number[];

    /** Emit a leading GREASE extension and a trailing GREASE extension. */
    greaseExtensions: boolean;
    /** Emit a GREASE encrypted_client_hello (ext 65037) when no real ECH config. */
    echGrease: boolean;
    /** Shuffle the middle extensions per-connection, as Chrome/BoringSSL do. */
    permuteExtensions: boolean;

    /**
     * Chrome's default request headers (values), applied by realFetch/the dispatcher unless
     * the caller overrides them. Note: HTTP header *order* cannot be controlled through the
     * fetch/undici path (the Fetch spec sorts headers) — the native backend controls order.
     */
    defaultHeaders?: Record<string, string>;

    /** tls-client identifier for the native (uTLS) backend, e.g. "chrome_133". */
    nativeIdentifier?: string;

    h2: Http2Profile;
}
