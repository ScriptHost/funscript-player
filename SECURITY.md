# Security Policy

## Supported versions

Only the **latest release** gets security fixes (see the version badge in the README). Update with
`docker compose pull && docker compose up -d`. The `:edge` image is a test build and not supported.

## Reporting a vulnerability

Please report security problems **privately** – never as a public issue or discussion:

1. Open the **Security** tab of this repository and choose **Report a vulnerability**
   (GitHub private vulnerability reporting).
2. Describe what you found, how to reproduce it, which version you used and what an attacker could do with it.
   Don't include real connection keys, passwords or private addresses.

## What happens next

- **Acknowledgement** within 7 days.
- **Assessment** within 14 days – you get a short note whether it is accepted and how severe it is.
- **Fix** in a new release as soon as possible (usually a patch release `x.y.Z`); critical issues first.
- You are credited in the changelog if you like (a nickname is fine).
- Please give us up to **90 days** before publishing details, or until the fix is released, whichever comes first.

## Scope

The player itself (server, interface, Docker image, release workflow). Problems in Stash, the Handy cloud, Intiface or
your reverse proxy belong to those projects – but tell us if the player makes them worse.

## Verifying downloads

- **ZIP:** every release contains `…zip.sha256` and a Sigstore signature `…zip.sigstore.json`:
  `cosign verify-blob --bundle handy-player-linux-vX.Y.Z.zip.sigstore.json --certificate-identity-regexp 'https://github.com/ScriptHost/funscript-player/' --certificate-oidc-issuer https://token.actions.githubusercontent.com handy-player-linux-vX.Y.Z.zip`
- **Docker image:** built by GitHub Actions from this repository, with an SBOM and build provenance attached.

---

**Deutsch:** Sicherheitsprobleme bitte **vertraulich** melden – im Reiter **Security** dieses Repositorys auf
**Report a vulnerability**, nicht als öffentliches Issue. Rückmeldung innerhalb von 7 Tagen, Einschätzung innerhalb von
14 Tagen, Behebung so schnell wie möglich in der neuesten Version. Bitte bis zu 90 Tage mit Veröffentlichungen warten
bzw. bis die Korrektur erschienen ist.
