#!/usr/bin/env node

/**
 * Unifi Proxy Server
 * TLS SNI Proxy for bypassing Unifi firmware update geo-blocking
 *
 * This server implements a TLS passthrough proxy that:
 * - Reads SNI from TLS ClientHello without decrypting
 * - Routes traffic to appropriate Unifi upstream servers
 * - Enforces IP whitelist for security
 * - Provides health check endpoint for Railway
 */

import net from 'net';
import tls from 'tls';
import logger from './logger.js';
import { config, validateConfig, getUpstreamForSNI } from './config.js';
import { parseSNI, hasEnoughDataForSNI } from './utils/sni-parser.js';
import { IPFilter } from './utils/ip-filter.js';
import { StatsTracker, startHealthCheckServer } from './health-check.js';

// Initialize components
const stats = new StatsTracker();
const ipFilter = new IPFilter(config.allowedIPs);

// Rate limiting map: IP -> { count, resetTime }
const rateLimitMap = new Map();

/**
 * Clean up rate limit map periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000); // Clean up every minute

/**
 * Check rate limit for IP
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const resetTime = now + 60000; // 1 minute window

  const existing = rateLimitMap.get(ip);
  if (!existing || now > existing.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime });
    return true;
  }

  if (existing.count >= config.rateLimitPerIP) {
    return false;
  }

  existing.count++;
  return true;
}

/**
 * Handle client connection
 */
function handleConnection(clientSocket) {
  const clientIP = clientSocket.remoteAddress;
  const clientPort = clientSocket.remotePort;
  const connectionId = `${clientIP}:${clientPort}`;

  const connLogger = logger.child({ connectionId, clientIP, clientPort });

  let upstreamSocket = null;
  let sniHostname = null;
  let dataBuffer = Buffer.alloc(0);
  let isUpstreamConnected = false;

  connLogger.debug('New connection established');

  // Check IP whitelist
  if (!ipFilter.isAllowed(clientIP)) {
    connLogger.warn({ clientIP }, 'Connection rejected: IP not in whitelist');
    stats.recordFailure();
    clientSocket.destroy();
    return;
  }

  // Check rate limit
  if (!checkRateLimit(clientIP)) {
    connLogger.warn({ clientIP }, 'Connection rejected: Rate limit exceeded');
    stats.recordFailure();
    clientSocket.destroy();
    return;
  }

  // Set timeout for receiving initial data (SNI)
  const prereadTimer = setTimeout(() => {
    if (!isUpstreamConnected) {
      connLogger.warn('Timeout waiting for TLS ClientHello');
      stats.recordFailure();
      clientSocket.destroy();
    }
  }, config.prereadTimeout);

  /**
   * Handle initial data to extract SNI
   */
  function onClientData(data) {
    // Append to buffer
    dataBuffer = Buffer.concat([dataBuffer, data]);

    // Check if we have enough data for SNI parsing
    if (!hasEnoughDataForSNI(dataBuffer)) {
      // Wait for more data
      return;
    }

    // Parse SNI
    sniHostname = parseSNI(dataBuffer);

    if (!sniHostname) {
      connLogger.warn('Failed to parse SNI from ClientHello');
      stats.recordFailure();
      clearTimeout(prereadTimer);
      clientSocket.destroy();
      return;
    }

    connLogger.info({ sni: sniHostname }, 'SNI extracted from ClientHello');

    // Get upstream target
    const upstream = getUpstreamForSNI(sniHostname);

    if (!upstream) {
      connLogger.warn({ sni: sniHostname }, 'SNI not in allowed domains list');
      stats.recordFailure();
      clearTimeout(prereadTimer);
      clientSocket.destroy();
      return;
    }

    // Record connection
    stats.recordConnection(clientIP, sniHostname);

    // Stop listening for more client data (we'll pipe it after connecting upstream)
    clientSocket.removeListener('data', onClientData);

    // Connect to upstream
    connectToUpstream(upstream);
  }

  /**
   * Connect to upstream server
   */
  function connectToUpstream(upstream) {
    connLogger.info({ upstream }, 'Connecting to upstream server');

    // Create TLS connection to upstream with SNI
    upstreamSocket = tls.connect({
      host: upstream.host,
      port: upstream.port,
      servername: upstream.host, // SNI for upstream
      rejectUnauthorized: false, // Accept any certificate (passthrough)
    });

    // Set timeout for upstream connection
    upstreamSocket.setTimeout(config.proxyConnectTimeout);

    upstreamSocket.on('secureConnect', () => {
      clearTimeout(prereadTimer);
      isUpstreamConnected = true;

      connLogger.info(
        { upstream, sni: sniHostname },
        'Connected to upstream server'
      );

      // Remove timeout
      upstreamSocket.setTimeout(0);

      // Set idle timeout
      upstreamSocket.setTimeout(config.proxyTimeout);
      clientSocket.setTimeout(config.proxyTimeout);

      // Send buffered ClientHello to upstream
      upstreamSocket.write(dataBuffer);
      dataBuffer = null; // Free memory

      // Pipe bidirectional data
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);

      stats.recordSuccess();
    });

    upstreamSocket.on('timeout', () => {
      connLogger.warn({ upstream }, 'Upstream connection timeout');
      stats.recordFailure();
      cleanup();
    });

    upstreamSocket.on('error', (err) => {
      connLogger.error(
        { err, upstream, sni: sniHostname },
        'Upstream connection error'
      );
      stats.recordFailure();
      cleanup();
    });

    upstreamSocket.on('end', () => {
      connLogger.debug('Upstream connection ended');
      cleanup();
    });

    upstreamSocket.on('close', () => {
      connLogger.debug('Upstream socket closed');
      cleanup();
    });
  }

  /**
   * Cleanup connections
   */
  function cleanup() {
    clearTimeout(prereadTimer);

    if (clientSocket && !clientSocket.destroyed) {
      clientSocket.unpipe();
      clientSocket.destroy();
    }

    if (upstreamSocket && !upstreamSocket.destroyed) {
      upstreamSocket.unpipe();
      upstreamSocket.destroy();
    }
  }

  // Listen for client data
  clientSocket.on('data', onClientData);

  // Handle client errors
  clientSocket.on('error', (err) => {
    connLogger.error({ err }, 'Client socket error');
    cleanup();
  });

  clientSocket.on('timeout', () => {
    connLogger.warn('Client socket timeout');
    cleanup();
  });

  clientSocket.on('end', () => {
    connLogger.debug('Client connection ended');
    cleanup();
  });

  clientSocket.on('close', () => {
    connLogger.debug('Client socket closed');
    cleanup();
  });
}

/**
 * Create TCP proxy server
 */
function createProxyServer() {
  const server = net.createServer(handleConnection);

  server.on('error', (err) => {
    logger.error({ err }, 'Proxy server error');
    process.exit(1);
  });

  return server;
}

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown(proxyServer, healthServer) {
  let isShuttingDown = false;

  async function shutdown(signal) {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

    // Stop accepting new connections
    proxyServer.close(() => {
      logger.info('Proxy server closed');
    });

    healthServer.close(() => {
      logger.info('Health check server closed');
    });

    // Wait a bit for active connections to finish
    setTimeout(() => {
      logger.info('Shutting down now');
      process.exit(0);
    }, 5000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Validate configuration
    validateConfig();

    logger.info({ config }, 'Starting Unifi Proxy Server');
    logger.info(
      { rules: ipFilter.getRules() },
      `IP Filter: ${ipFilter.getRuleCount()} rule(s) configured`
    );

    // Start health check server
    const healthServer = await startHealthCheckServer(stats, ipFilter);

    // Create and start proxy server
    const proxyServer = createProxyServer();

    proxyServer.listen(config.port, () => {
      logger.info(
        {
          port: config.port,
          healthPort: config.healthPort,
          allowedIPs: ipFilter.getRules(),
        },
        '🚀 Unifi Proxy Server is running'
      );
    });

    // Setup graceful shutdown
    setupGracefulShutdown(proxyServer, healthServer);
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start server
main();
