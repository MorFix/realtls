/**
 * @realtls/native — highest-fidelity backend for realtls, wrapping the uTLS
 * (bogdanfinn/tls-client) shared library via FFI. The prebuilt binary ships in a
 * per-platform optional package (`@realtls/native-<platform>`); nothing is downloaded at
 * runtime, so it works in read-only and air-gapped environments.
 */
export { nativeFetch, type NativeFetchInit } from './fetch.js';
export { nativeRequest, type NativeRequest, type NativeResponse } from './tlsClient.js';
export { loadTlsClient, isNativeAvailable, resolveLibraryPath, type TlsClientLib } from './loader.js';
export { platformKey, nativePackageName } from './platform.js';
export { chrome, type NativeProfile } from './profile.js';
