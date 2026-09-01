# Security Policy

## Supported Versions

We provide security updates and patches for the latest version of the Discord Music Bot.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

---

## Reporting a Vulnerability

We take the security of this project seriously. If you discover a vulnerability or potential security issue, please **do NOT** disclose it publicly via GitHub issues, discussions, or social media.

### Reporting Process
1. **GitHub Private Vulnerability Reporting (Preferred)**:
   - Navigate to the [Security tab](../../security) of this repository.
   - Click on **Advisories** and then **Report a vulnerability**.
2. **Email**:
   - If private advisories are unavailable, contact the maintainers directly via email with details of the vulnerability.

### What to Include in Your Report
To help us triage and resolve the issue quickly, please provide:
- A clear description of the vulnerability and its potential impact.
- Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
- Relevant environment details (OS, Node version, Docker version, etc.).

### Response Timeline
- **Initial Response**: We will acknowledge receipt of your report within 48 hours.
- **Assessment & Status**: We will provide an assessment and timeline for a fix within 5 business days.
- **Resolution**: Once a patch is developed and verified, a security release will be published and credit will be given (unless requested otherwise).

---

## Security Best Practices for Self-Hosters

When running your own instance:
1. **Never commit `.env` or secrets**: Keep `TOKEN`, `ADMIN_TOKEN`, and `TUNNEL_TOKEN` strictly in your local `.env` file or secure secret store.
2. **Use Strong Admin Tokens**: Set `ADMIN_TOKEN` to a cryptographically strong string of at least 24 random characters.
3. **Restrict Network Exposure**: When using Cloudflare Tunnel, bind host port `8080` to `127.0.0.1` (`DASHBOARD_BIND_ADDRESS=127.0.0.1`) and remove external firewall access to port `8080`.
4. **Protect Cookies**: If using YouTube cookies (`cookies.txt`), use a throwaway account and keep the file permissions restricted (`chmod 600 data/cookies.txt`).
