/**
 * Health Check HTTP Server
 * Provides a simple HTTP endpoint for Railway health checks and monitoring
 */

import http from 'http';
import logger from './logger.js';
import { config, getAllowedDomains } from './config.js';

/**
 * Statistics tracker
 */
export class StatsTracker {
  constructor() {
    this.startTime = Date.now();
    this.connections = {
      total: 0,
      active: 0,
      successful: 0,
      failed: 0,
    };
    this.domains = {};
    this.ipConnections = {};
  }

  recordConnection(ip, sni) {
    this.connections.total++;
    this.connections.active++;

    if (sni) {
      this.domains[sni] = (this.domains[sni] || 0) + 1;
    }

    if (ip) {
      this.ipConnections[ip] = (this.ipConnections[ip] || 0) + 1;
    }
  }

  recordSuccess() {
    this.connections.successful++;
    this.connections.active = Math.max(0, this.connections.active - 1);
  }

  recordFailure() {
    this.connections.failed++;
    this.connections.active = Math.max(0, this.connections.active - 1);
  }

  getStats() {
    const uptime = Date.now() - this.startTime;
    return {
      uptime: {
        ms: uptime,
        human: formatUptime(uptime),
      },
      connections: { ...this.connections },
      domains: { ...this.domains },
      topIPs: this.getTopIPs(5),
    };
  }

  getTopIPs(limit = 5) {
    return Object.entries(this.ipConnections)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([ip, count]) => ({ ip, count }));
  }
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Create health check HTTP server
 */
export function createHealthCheckServer(stats, ipFilter) {
  const server = http.createServer((req, res) => {
    const { method, url } = req;

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    // Health check endpoint
    if (url === '/health' || url === '/') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'unifi-proxy',
        version: '1.0.0',
      }));
      return;
    }

    // Detailed stats endpoint
    if (url === '/stats') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        stats: stats.getStats(),
        config: {
          allowedDomains: getAllowedDomains(),
          ipFilterRules: ipFilter.getRules(),
          port: config.port,
        },
      }, null, 2));
      return;
    }

    // Readiness check (for Railway)
    if (url === '/ready') {
      res.writeHead(200);
      res.end(JSON.stringify({
        ready: true,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // 404 for unknown routes
    res.writeHead(404);
    res.end(JSON.stringify({
      error: 'Not found',
      availableEndpoints: ['/health', '/stats', '/ready'],
    }));
  });

  // Error handling
  server.on('error', (err) => {
    logger.error({ err }, 'Health check server error');
  });

  return server;
}

/**
 * Start health check server
 */
export function startHealthCheckServer(stats, ipFilter) {
  const server = createHealthCheckServer(stats, ipFilter);

  return new Promise((resolve, reject) => {
    server.listen(config.healthPort, () => {
      logger.info(
        { port: config.healthPort },
        'Health check server listening'
      );
      resolve(server);
    });

    server.on('error', reject);
  });
}

export default {
  StatsTracker,
  createHealthCheckServer,
  startHealthCheckServer,
};
