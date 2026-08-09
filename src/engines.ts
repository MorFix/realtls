import { isNativeAvailable } from './native/loader.js';

export type EngineName = 'pure' | 'native';

/** Runtime capability check for available engines. */
export const engines = {
    /** Returns which engines can run here: always 'pure', plus 'native' if the uTLS lib loads. */
    async available(): Promise<EngineName[]> {
        const list: EngineName[] = ['pure'];
        if (await isNativeAvailable()) list.push('native');
        return list;
    },
};
