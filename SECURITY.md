# Security

This is a hobby project, maintained in spare time – but security reports are welcome and taken seriously.

## Reporting a problem

Please report security problems **privately**, not as a public issue: open the **Security** tab of this repository and
choose **Report a vulnerability**. Describe what you found and how to reproduce it – no real keys, passwords or private
addresses, please.

I'll look at it as soon as I can and fix real problems in the next release. If you plan to write about it, please wait
until a fix is out.

## Versions

Only the latest release gets fixes. Update with `docker compose pull && docker compose up -d`.

## Checking downloads

Releases come with a SHA-256 checksum and a Sigstore signature for the ZIP; the Docker image is built by GitHub Actions
from this repository.

---

**Deutsch:** Hobbyprojekt – Sicherheitsprobleme trotzdem gern **vertraulich** melden: Reiter **Security** →
**Report a vulnerability**, nicht als öffentliches Issue. Ich schaue es mir an, sobald ich kann, und behebe echte
Probleme in der nächsten Version.
