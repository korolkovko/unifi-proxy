/**
 * IP Filter - IP whitelist with CIDR notation support
 *
 * Supports:
 * - Individual IPs: 192.168.1.1
 * - CIDR notation: 10.0.0.0/24
 * - IPv4 only (IPv6 support can be added if needed)
 */

/**
 * Parse IP address to 32-bit integer
 * @param {string} ip - IP address string
 * @returns {number} - 32-bit integer representation
 */
function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => p < 0 || p > 255)) {
    throw new Error(`Invalid IP address: ${ip}`);
  }
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

/**
 * Parse CIDR notation
 * @param {string} cidr - CIDR string (e.g., "192.168.1.0/24")
 * @returns {Object} - { network: number, mask: number }
 */
function parseCIDR(cidr) {
  const [ip, prefixLen] = cidr.split('/');
  const prefix = parseInt(prefixLen, 10);

  if (isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR prefix: ${cidr}`);
  }

  const network = ipToInt(ip);
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;

  return { network: network & mask, mask };
}

/**
 * Check if IP matches CIDR range
 * @param {number} ipInt - IP address as integer
 * @param {Object} cidr - { network: number, mask: number }
 * @returns {boolean} - True if IP is in CIDR range
 */
function matchesCIDR(ipInt, cidr) {
  return (ipInt & cidr.mask) === cidr.network;
}

/**
 * IP Filter class for whitelist management
 */
export class IPFilter {
  constructor(allowedIPs = []) {
    this.rules = [];
    this.setAllowedIPs(allowedIPs);
  }

  /**
   * Set allowed IPs from array or comma-separated string
   * @param {string|Array} allowedIPs - IPs or CIDR ranges
   */
  setAllowedIPs(allowedIPs) {
    this.rules = [];

    let ipList = [];
    if (typeof allowedIPs === 'string') {
      ipList = allowedIPs.split(',').map(ip => ip.trim()).filter(Boolean);
    } else if (Array.isArray(allowedIPs)) {
      ipList = allowedIPs;
    }

    for (const entry of ipList) {
      try {
        if (entry.includes('/')) {
          // CIDR notation
          this.rules.push({ type: 'cidr', cidr: parseCIDR(entry), original: entry });
        } else {
          // Single IP
          this.rules.push({ type: 'ip', ip: ipToInt(entry), original: entry });
        }
      } catch (error) {
        console.warn(`Invalid IP filter entry: ${entry} - ${error.message}`);
      }
    }
  }

  /**
   * Check if IP is allowed
   * @param {string} ip - IP address to check
   * @returns {boolean} - True if IP is allowed
   */
  isAllowed(ip) {
    // Empty rules = allow all (for testing/development)
    if (this.rules.length === 0) {
      return true;
    }

    // Check if this is a special case (0.0.0.0/0 = allow all)
    const allowAll = this.rules.some(
      rule => rule.type === 'cidr' && rule.cidr.network === 0 && rule.cidr.mask === 0
    );

    if (allowAll) {
      return true;
    }

    try {
      const ipInt = ipToInt(ip);

      for (const rule of this.rules) {
        if (rule.type === 'ip') {
          if (ipInt === rule.ip) {
            return true;
          }
        } else if (rule.type === 'cidr') {
          if (matchesCIDR(ipInt, rule.cidr)) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      // Invalid IP format
      return false;
    }
  }

  /**
   * Get list of configured rules
   * @returns {Array} - Array of rule strings
   */
  getRules() {
    return this.rules.map(rule => rule.original);
  }

  /**
   * Get count of rules
   * @returns {number} - Number of rules
   */
  getRuleCount() {
    return this.rules.length;
  }
}

export default IPFilter;
