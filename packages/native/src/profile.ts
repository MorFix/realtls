/**
 * Minimal Chrome profile for the native backend. uTLS ships the full TLS + HTTP/2
 * fingerprint database keyed by `identifier`; we only supply the request header values and
 * their order. Kept self-contained so this package has no dependency on @realtls/js.
 */
export interface NativeProfile {
    /** tls-client identifier (uTLS built-in browser fingerprint). */
    identifier: string;
    /** Default request header values, applied under caller-provided headers. */
    defaultHeaders: Record<string, string>;
    /** Header order sent on the wire (uTLS honours this exactly). */
    headerOrder: string[];
}

export const chrome: NativeProfile = {
    // uTLS 1.15.1's newest Chrome profile; closest to the captured Chrome 151.
    identifier: 'chrome_133',
    defaultHeaders: {
        'sec-ch-ua': '"Chromium";v="133", "Not.A/Brand";v="24", "Google Chrome";v="133"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'upgrade-insecure-requests': '1',
        'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'sec-fetch-site': 'none',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-user': '?1',
        'sec-fetch-dest': 'document',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9',
        priority: 'u=0, i',
    },
    headerOrder: [
        'sec-ch-ua',
        'sec-ch-ua-mobile',
        'sec-ch-ua-platform',
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
};
