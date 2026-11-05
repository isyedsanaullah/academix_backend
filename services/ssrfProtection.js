'use strict';

/**
 * ssrfProtection.js — Phase 9E (#N06)
 * Strict Anti-SSRF Defense for Webhooks:
 * - Requires HTTPS on port 443
 * - Validates hostname against private/internal/cloud metadata IP ranges at registration
 * - Re-resolves DNS and pins the IP at every delivery to prevent DNS rebinding attacks
 */

const dns = require('dns').promises;
const net = require('net');

/**
 * Convert IPv4 string to 32-bit unsigned integer
 */
function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

/**
 * Check if an IPv4 address falls within a CIDR range
 */
function inCidr(ip, cidrIp, maskBits) {
  const ipLong = ipToLong(ip);
  const cidrLong = ipToLong(cidrIp);
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipLong & mask) === (cidrLong & mask);
}

/**
 * Check if an IP (IPv4 or IPv6) is internal/private/loopback/link-local/metadata
 */
function isRestrictedIp(ip) {
  if (!ip) return true;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    // 0.0.0.0/8 (Broadcast/Current network)
    if (inCidr(ip, '0.0.0.0', 8)) return true;
    // 10.0.0.0/8 (Private)
    if (inCidr(ip, '10.0.0.0', 8)) return true;
    // 127.0.0.0/8 (Loopback)
    if (inCidr(ip, '127.0.0.0', 8)) return true;
    // 169.254.0.0/16 (Link-local & AWS/GCP/Azure Metadata 169.254.169.254)
    if (inCidr(ip, '169.254.0.0', 16)) return true;
    // 172.16.0.0/12 (Private)
    if (inCidr(ip, '172.16.0.0', 12)) return true;
    // 192.168.0.0/16 (Private)
    if (inCidr(ip, '192.168.0.0', 16)) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (inCidr(ip, '224.0.0.0', 4) || inCidr(ip, '240.0.0.0', 4)) return true;
    // 255.255.255.255 (Broadcast)
    if (ip === '255.255.255.255') return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // ::1 (Loopback) & :: (Unspecified)
    if (lower === '::1' || lower === '::') return true;
    // fc00::/7 (Unique local address)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // fe80::/10 (Link-local)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (lower.startsWith('::ffff:')) {
      const v4Part = lower.slice(7);
      if (net.isIPv4(v4Part)) return isRestrictedIp(v4Part);
    }
    return false;
  }

  return true;
}

/**
 * Validate webhook URL at registration time
 * Rejects non-HTTPS, non-443, localhosts, and private IPs
 */
async function validateWebhookUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw Object.assign(new Error('Invalid URL format.'), { status: 400, code: 'INVALID_URL' });
  }

  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Webhook URL must use HTTPS.'), { status: 400, code: 'HTTPS_REQUIRED' });
  }

  const port = parsed.port;
  if (port && port !== '443') {
    throw Object.assign(new Error('Webhook endpoints must use standard HTTPS port 443.'), {
      status: 400,
      code: 'INVALID_PORT'
    });
  }

  const hostname = parsed.hostname;
  if (!hostname || hostname.toLowerCase() === 'localhost') {
    throw Object.assign(new Error('Localhost target URLs are prohibited.'), { status: 400, code: 'SSRF_RESTRICTED' });
  }

  // Resolve hostname DNS to check all target IPs
  let addresses = [];
  try {
    const res = await dns.lookup(hostname, { all: true });
    addresses = res.map(r => r.address);
  } catch (err) {
    throw Object.assign(new Error(`DNS resolution failed for hostname "${hostname}": ${err.message}`), {
      status: 400,
      code: 'DNS_RESOLUTION_FAILED'
    });
  }

  if (addresses.length === 0) {
    throw Object.assign(new Error(`Hostname "${hostname}" did not resolve to any IP address.`), {
      status: 400,
      code: 'DNS_NO_ADDRESS'
    });
  }

  for (const addr of addresses) {
    if (isRestrictedIp(addr)) {
      throw Object.assign(new Error(`Webhook target resolves to restricted internal or private IP address (${addr}).`), {
        status: 400,
        code: 'SSRF_RESTRICTED'
      });
    }
  }

  return { valid: true, parsed, resolvedIps: addresses };
}

/**
 * Re-resolve DNS right before delivery to pin IP and prevent DNS rebinding
 */
async function resolvePinnedIp(rawUrl) {
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname;

  // If already a raw IP string
  if (net.isIP(hostname)) {
    if (isRestrictedIp(hostname)) {
      throw new Error(`Target IP "${hostname}" is restricted.`);
    }
    return { parsedUrl: parsed, pinnedIp: hostname, hostname };
  }

  const res = await dns.lookup(hostname, { all: true });
  const validAddresses = res.filter(r => !isRestrictedIp(r.address)).map(r => r.address);

  if (validAddresses.length === 0) {
    throw new Error(`DNS resolution for "${hostname}" yielded only restricted or internal IPs.`);
  }

  // Pick first valid public IP
  const pinnedIp = validAddresses[0];

  return { parsedUrl: parsed, pinnedIp, hostname };
}

module.exports = {
  isRestrictedIp,
  validateWebhookUrl,
  resolvePinnedIp
};

