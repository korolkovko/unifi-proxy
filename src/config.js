/**
 * Configuration Module
 * Centralizes all environment variables and configuration
 */

/**
 * Unifi domains that need to be proxied
 * Maps SNI hostname to upstream target
 */
export const UNIFI_DOMAINS = {
  'fw-download.ubnt.com': { host: 'fw-download.ubnt.com', port: 443 },
  'fw-update.ubnt.com': { host: 'fw-update.ubnt.com', port: 443 },
  'fw-update.ui.com': { host: 'fw-update.ui.com', port: 443 },
  'apt.artifacts.ui.com': { host: 'apt.artifacts.ui.com', port: 443 },
  'apt-beta.artifacts.ui.com': { host: 'apt-beta.artifacts.ui.com', port: 443 },
  'apt-release-candidate.artifacts.ui.com': { host: 'apt-release-candidate.artifacts.ui.com', port: 443 },
};

/**
 * Server configuration
 */
export const config = {
  // Server ports
  port: parseInt(process.env.PORT || '443', 10),
  healthPort: parseInt(process.env.HEALTH_PORT || '3000', 10),

  // IP Whitelist
  allowedIPs: process.env.ALLOWED_IPS || '0.0.0.0/0',

  // Timeouts (milliseconds)
  proxyConnectTimeout: parseInt(process.env.PROXY_CONNECT_TIMEOUT || '10000', 10),
  proxyTimeout: parseInt(process.env.PROXY_TIMEOUT || '300000', 10),
  prereadTimeout: parseInt(process.env.PREREAD_TIMEOUT || '10000', 10),

  // Rate limiting
  rateLimitPerIP: parseInt(process.env.RATE_LIMIT_PER_IP || '100', 10),

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logPretty: process.env.LOG_PRETTY === 'true',

  // Environment
  nodeEnv: process.env.NODE_ENV || 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};

/**
 * Validate configuration
 * @throws {Error} If configuration is invalid
 */
export function validateConfig() {
  const errors = [];

  // Validate ports
  if (config.port < 1 || config.port > 65535) {
    errors.push(`Invalid PORT: ${config.port}. Must be between 1 and 65535.`);
  }

  if (config.healthPort < 1 || config.healthPort > 65535) {
    errors.push(`Invalid HEALTH_PORT: ${config.healthPort}. Must be between 1 and 65535.`);
  }

  if (config.port === config.healthPort) {
    errors.push(`PORT and HEALTH_PORT cannot be the same: ${config.port}`);
  }

  // Validate timeouts
  if (config.proxyConnectTimeout < 1000) {
    errors.push(`PROXY_CONNECT_TIMEOUT too low: ${config.proxyConnectTimeout}ms. Minimum is 1000ms.`);
  }

  if (config.proxyTimeout < 1000) {
    errors.push(`PROXY_TIMEOUT too low: ${config.proxyTimeout}ms. Minimum is 1000ms.`);
  }

  // Validate rate limit
  if (config.rateLimitPerIP < 1) {
    errors.push(`RATE_LIMIT_PER_IP must be at least 1: ${config.rateLimitPerIP}`);
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Get upstream target for SNI hostname
 * @param {string} sni - SNI hostname
 * @returns {Object|null} - { host, port } or null if not allowed
 */
export function getUpstreamForSNI(sni) {
  if (!sni) {
    return null;
  }

  return UNIFI_DOMAINS[sni] || null;
}

/**
 * Check if SNI is allowed
 * @param {string} sni - SNI hostname
 * @returns {boolean} - True if SNI is in allowed list
 */
export function isAllowedSNI(sni) {
  return sni && UNIFI_DOMAINS.hasOwnProperty(sni);
}

/**
 * Get list of all allowed SNI domains
 * @returns {Array<string>} - Array of domain names
 */
export function getAllowedDomains() {
  return Object.keys(UNIFI_DOMAINS);
}

export default config;
