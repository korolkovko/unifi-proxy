# Unifi Firmware Proxy

🚀 **TLS SNI Proxy for bypassing Unifi firmware update geo-blocking**

This Node.js application implements a TLS passthrough proxy that routes Unifi device firmware update traffic through your own server, effectively bypassing geo-restrictions without decrypting traffic.

## ✨ Features

- **TLS Passthrough** - SNI inspection without decrypting traffic (end-to-end encryption preserved)
- **IP Whitelist** - CIDR notation support for security
- **Rate Limiting** - Per-IP connection limits
- **Health Checks** - Railway-compatible health endpoints
- **Structured Logging** - JSON logs with Pino for production monitoring
- **Graceful Shutdown** - Proper connection cleanup on SIGTERM/SIGINT
- **Statistics** - Real-time connection and domain metrics

## 🎯 Supported Domains

The proxy automatically routes traffic for these Unifi domains:

- `fw-download.ubnt.com`
- `fw-update.ubnt.com`
- `fw-update.ui.com`
- `apt.artifacts.ui.com`
- `apt-beta.artifacts.ui.com`
- `apt-release-candidate.artifacts.ui.com`

## 🚀 Quick Start

### Deploy to Railway

1. **Fork this repository** to your GitHub account

2. **Create a new Railway project**:
   - Go to [Railway](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your forked repository

3. **Configure environment variables** in Railway dashboard:
   ```env
   ALLOWED_IPS=YOUR_WAN_IP
   LOG_LEVEL=info
   ```

   **Important Notes:**
   - `PORT` - Don't set manually, Railway auto-assigns (will be exposed as 443 externally)
   - `ALLOWED_IPS` - **Must** be set to your WAN IP for security
   - `HEALTH_PORT` - Optional, defaults to 3000

4. **Get your Railway deployment URL** - Railway will provide a public IP/domain

5. **Configure your Unifi Network** (see Configuration section below)

### Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your settings
nano .env

# Run in development mode (with auto-restart)
npm run dev

# Or run in production mode
npm start
```

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `443` | Main proxy server port (Railway will auto-assign) |
| `HEALTH_PORT` | `3000` | Health check HTTP server port |
| `ALLOWED_IPS` | `0.0.0.0/0` | Comma-separated IPs or CIDR ranges |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `LOG_PRETTY` | `false` | Enable pretty logs for development |
| `PROXY_CONNECT_TIMEOUT` | `10000` | Upstream connection timeout (ms) |
| `PROXY_TIMEOUT` | `300000` | Idle connection timeout (ms) |
| `PREREAD_TIMEOUT` | `10000` | ClientHello read timeout (ms) |
| `RATE_LIMIT_PER_IP` | `100` | Connections per IP per minute |

### IP Whitelist Examples

```env
# Single IP
ALLOWED_IPS=203.0.113.5

# Multiple IPs
ALLOWED_IPS=203.0.113.5,198.51.100.10

# CIDR notation (subnet)
ALLOWED_IPS=192.168.1.0/24

# Mixed
ALLOWED_IPS=203.0.113.5,192.168.0.0/16,10.0.0.1
```

## 🔧 Unifi Network Configuration

After deploying the proxy, configure DNS overrides in your Unifi Network Controller:

### UniFi Network 9.4.19+ (Policy Engine)

1. Navigate to **Settings** → **Advanced Features** → **Policy Engine**
2. Go to **Policy Table** tab
3. Click **Create New Policy**
4. Select **DNS** → Type: **Host (A)**
5. Add these DNS overrides (replace `YOUR_RAILWAY_IP` with your Railway deployment IP):

| Domain Name | IP Address |
|-------------|------------|
| `fw-update.ubnt.com` | `YOUR_RAILWAY_IP` |
| `fw-download.ubnt.com` | `YOUR_RAILWAY_IP` |
| `fw-update.ui.com` | `YOUR_RAILWAY_IP` |
| `apt.artifacts.ui.com` | `YOUR_RAILWAY_IP` |
| `apt-beta.artifacts.ui.com` | `YOUR_RAILWAY_IP` |
| `apt-release-candidate.artifacts.ui.com` | `YOUR_RAILWAY_IP` |

## 🧪 Testing

### Test from your local network

```bash
# Replace YOUR_RAILWAY_IP with your deployment IP
curl -I --resolve fw-download.ubnt.com:443:YOUR_RAILWAY_IP https://fw-download.ubnt.com/

# Expected response:
# HTTP/2 403
# x-amz-cf-pop: FRAxx
# server: cloudflare
```

The `403` response is normal (S3 bucket root access is forbidden), but it confirms the proxy is working.

### Test from Unifi device (SSH)

```bash
# SSH to your UDM-Pro
ssh root@YOUR_UDM_IP

# Check DNS resolution
nslookup fw-download.ubnt.com
# Should return: YOUR_RAILWAY_IP

# Test connection
curl -I https://fw-download.ubnt.com/
# Should return: HTTP/2 403 with CloudFront headers
```

## 📊 Monitoring

### Health Check Endpoints

- **`/health`** - Basic health check (for Railway)
  ```bash
  curl http://your-railway-app.railway.app:3000/health
  ```

- **`/stats`** - Detailed statistics
  ```bash
  curl http://your-railway-app.railway.app:3000/stats
  ```

- **`/ready`** - Readiness check
  ```bash
  curl http://your-railway-app.railway.app:3000/ready
  ```

### Logs

View logs in Railway dashboard or locally:

```bash
# Railway CLI
railway logs

# Local development
npm start
```

## 🏗️ Architecture

```
┌─────────────────┐
│  Unifi Device   │
│  (UDM-Pro, etc) │
└────────┬────────┘
         │ DNS resolves fw-update.ubnt.com → Railway IP
         ↓
┌─────────────────┐
│  Railway Proxy  │
│  (This app)     │
│                 │
│  1. Read SNI    │
│  2. Check IP    │
│  3. Route       │
└────────┬────────┘
         │ TLS passthrough (no decryption)
         ↓
┌─────────────────┐
│  CloudFront     │
│  fw-update.     │
│  ubnt.com       │
└─────────────────┘
```

### How It Works

1. **Client Hello**: Unifi device initiates TLS connection
2. **SNI Extraction**: Proxy reads SNI from ClientHello (without decrypting)
3. **IP Validation**: Checks if client IP is in whitelist
4. **Domain Routing**: Maps SNI to correct upstream (e.g., `fw-update.ubnt.com:443`)
5. **TLS Passthrough**: Forwards raw TLS traffic bidirectionally
6. **End-to-End Encryption**: Traffic remains encrypted throughout

## 🔐 Security Considerations

1. **IP Whitelist**: Always configure `ALLOWED_IPS` to restrict access
2. **Rate Limiting**: Prevents abuse with per-IP connection limits
3. **No Decryption**: TLS traffic is never decrypted (passthrough only)
4. **Non-root User**: Docker container runs as unprivileged user
5. **Graceful Shutdown**: Proper connection cleanup on restart

## 🐛 Troubleshooting

### Proxy not accepting connections

```bash
# Check Railway logs
railway logs

# Verify PORT is set correctly (Railway auto-assigns)
# Check ALLOWED_IPS includes your WAN IP
```

### Unifi devices not connecting

```bash
# Verify DNS overrides in Unifi Controller
# Test DNS resolution from device:
nslookup fw-update.ubnt.com

# Check firewall rules on Railway (should allow port 443)
```

### Connection timeouts

```env
# Increase timeouts in Railway environment variables
PROXY_CONNECT_TIMEOUT=20000
PROXY_TIMEOUT=600000
```

## 📦 Project Structure

```
unifi-proxy/
├── src/
│   ├── server.js           # Main TCP proxy server
│   ├── config.js           # Configuration management
│   ├── logger.js           # Pino logger setup
│   ├── health-check.js     # Health endpoints & stats
│   └── utils/
│       ├── sni-parser.js   # SNI extraction from TLS
│       └── ip-filter.js    # IP whitelist with CIDR
├── Dockerfile              # Multi-stage Docker build
├── railway.json            # Railway configuration
├── package.json
├── .env.example
└── README.md
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🙏 Credits

Based on the NGINX TLS passthrough configuration guide for Unifi firmware updates.

## ⚠️ Disclaimer

This proxy is intended for bypassing legitimate geo-restrictions on Unifi firmware updates. Use responsibly and in compliance with Ubiquiti's terms of service.

---

**Made with ❤️ for the Unifi community**
