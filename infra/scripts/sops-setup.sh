#!/bin/sh
# sops-setup.sh — one-time bootstrap for SOPS + age encryption.
#
# Linux VPS only. This script auto-installs age (via apt) and sops
# (direct binary download) on the target host. macOS operators should
# install age and sops separately; this bootstrap script is not for macOS.
#
# Generates an age keypair, updates .sops.yaml with the public key,
# and encrypts the placeholder secrets file.
#
# Usage:
#   cd infra && ./scripts/sops-setup.sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

SOPS_CONFIG="$INFRA_DIR/.sops.yaml"
SECRETS_FILE="$INFRA_DIR/group_vars/all.sops.yml"
AGE_DIR="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age}"
AGE_KEY_FILE="$AGE_DIR/keys.txt"

# ── check and install prerequisites ────────────────────────────────────

install_missing() {
    printf 'Installing missing prerequisites...\n'

    # age (provides age and age-keygen)
    if ! command -v age >/dev/null 2>&1; then
        printf '  Installing age...\n'
        if command -v apt >/dev/null 2>&1; then
            sudo apt-get update -qq && sudo apt-get install -y -qq age
        else
            printf 'Error: cannot auto-install age on this Linux host.\n' >&2
            printf 'Install manually: sudo apt install age\n' >&2
            return 1
        fi
    fi

    # sops
    if ! command -v sops >/dev/null 2>&1; then
        printf '  Installing sops...\n'
        SOPS_VERSION="3.9.4"
        SOPS_URL="https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.amd64"
        if command -v curl >/dev/null 2>&1; then
            sudo curl -fsSL "$SOPS_URL" -o /usr/local/bin/sops
            sudo chmod +x /usr/local/bin/sops
        else
            printf 'Error: cannot auto-install sops (curl not found).\n' >&2
            printf '  Download from: https://github.com/getsops/sops/releases\n' >&2
            return 1
        fi
    fi
}

ALL_PRESENT=true
for cmd in age age-keygen sops; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        ALL_PRESENT=false
        break
    fi
done

if [ "$ALL_PRESENT" = "false" ]; then
    printf 'Some prerequisites are missing.\n'
    printf 'Attempting to install (requires sudo)...\n\n'
    install_missing || exit 1
fi

# Final verification
for cmd in age age-keygen sops; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        printf 'Error: %s still not found after install attempt.\n' "$cmd" >&2
        exit 1
    fi
done
printf 'Prerequisites OK: age, age-keygen, sops\n'

# ── generate age keypair if missing ────────────────────────────────────

if [ -f "$AGE_KEY_FILE" ]; then
    printf 'Age key already exists at: %s\n' "$AGE_KEY_FILE"
else
    mkdir -p "$(dirname "$AGE_KEY_FILE")"
    age-keygen -o "$AGE_KEY_FILE" 2>&1
    chmod 600 "$AGE_KEY_FILE"
    printf 'Generated new age keypair at: %s\n' "$AGE_KEY_FILE"
fi

# Extract public key
PUBLIC_KEY=$(grep -oP 'age1\w+' "$AGE_KEY_FILE" | head -1)
if [ -z "$PUBLIC_KEY" ]; then
    printf 'Error: could not extract public key from %s\n' "$AGE_KEY_FILE" >&2
    exit 1
fi
printf 'Age public key: %s\n' "$PUBLIC_KEY"

# ── update .sops.yaml with real public key ─────────────────────────────

if grep -q "REPLACE_WITH_REAL_PUBLIC_KEY" "$SOPS_CONFIG"; then
    sed -i "s/age1REPLACE_WITH_REAL_PUBLIC_KEY_FROM_SETUP/$PUBLIC_KEY/" "$SOPS_CONFIG"
    printf 'Updated .sops.yaml with public key.\n'
else
    printf '.sops.yaml already configured (no placeholder found).\n'
fi

# ── encrypt the secrets file ───────────────────────────────────────────

if grep -q "PLACEHOLDER" "$SECRETS_FILE"; then
    printf '\nNow edit the secrets file with real values:\n'
    printf '  sops %s\n\n' "$SECRETS_FILE"
    printf 'SOPS will open $EDITOR. Replace PLACEHOLDER values, save, and quit.\n'
    printf 'The file will be encrypted on save.\n'
else
    printf 'Secrets file appears already configured.\n'
fi

printf '\nSetup complete.\n'
printf 'IMPORTANT: Never commit %s\n' "$AGE_KEY_FILE"
printf 'Transfer the private key to other operators securely (not over plaintext).\n'
