# Security Policy

## Supported versions

Security fixes are applied to the latest code on `main` and to the latest published release when one exists.

## Reporting a vulnerability

Please do **not** disclose a vulnerability in a public issue, discussion or pull request.

1. Use GitHub Security Advisories / private vulnerability reporting for this repository when it is enabled.
2. Include a minimal reproduction, affected version, impact and suggested mitigation where possible.
3. Allow maintainers reasonable time to investigate and prepare a fix before public disclosure.

Maintainers will acknowledge reports, assess severity, communicate progress and credit reporters when requested.

## Deployment guidance

- Keep `archviz serve` bound to loopback unless LAN access is necessary.
- LAN listeners require a token automatically; treat the printed URL as a credential.
- The automatic token protects application access but does not encrypt traffic. Use HTTPS, a VPN or a trusted reverse proxy on untrusted networks.
- Do not store production API keys in shared Studio state. Browser-held provider keys remain local to that browser.
- Only import SVG files from trusted sources. DiagramC sanitizes active content and external links, but SVG is a complex format and should be treated as untrusted input.
