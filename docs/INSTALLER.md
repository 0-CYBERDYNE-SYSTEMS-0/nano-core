# Installer

## Canonical URL

The canonical install script is hosted at:

```
https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/nano-core/main/scripts/install.sh
```

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/nano-core/main/scripts/install.sh | bash
```

## Runtime Selection

```bash
# Docker runtime (recommended default)
curl -fsSL https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/nano-core/main/scripts/install.sh | bash -s -- --runtime docker

# Host runtime (no container)
curl -fsSL https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/nano-core/main/scripts/install.sh | bash -s -- --runtime host
```

## Pinning a Version

By default the installer resolves `FFT_NANO_REF=latest` to the latest GitHub release.
Pin to a specific tag by setting `FFT_NANO_REF` explicitly.

## See Also

- `docs/ONBOARDING.md` for the guided onboarding wrapper
- `docs/RELEASE.md` for the release process
