/** @typedef {{ id: string; name?: string; enabled?: boolean; sitePath?: string }} ServiceEntry */

/**
 * @typedef {object} PublicConfig
 * @property {string} activeEnvironment
 * @property {string} [apiBase]
 * @property {{ provider?: string; mode?: string; baseUrl?: string; publicBaseUrl?: string }} [storage]
 * @property {{ provider?: string; mode?: string; baseUrl?: string; endpoints?: Record<string, string> }} [inference]
 * @property {ServiceEntry[]} [services]
 */

export {};
