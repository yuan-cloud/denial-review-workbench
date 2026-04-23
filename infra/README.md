# infra/ — Ansible + SOPS/age scaffold

Single-host deployment scaffold for the Denial Review Workbench on the
Contabo VPS. Later beads add Caddy, systemd, and backup roles on top
of this foundation.

## Layout

```
infra/
├── README.md                 # this file
├── site.yml                  # playbook entrypoint
├── ansible.cfg               # local ansible config
├── .sops.yaml                # SOPS encryption rules
├── inventory/
│   ├── hosts.yml             # inventory (single host)
│   └── host_vars/
│       └── workbench.yml     # per-host variables (plaintext)
├── group_vars/
│   ├── all.yml               # shared variables (plaintext)
│   └── all.sops.yml          # encrypted secrets (SOPS + age)
├── roles/
│   ├── common/tasks/main.yml # base system (apt, users, dirs)
│   └── secrets/tasks/main.yml# decrypt + place secrets
└── scripts/
    └── sops-setup.sh         # one-time age key + SOPS bootstrap
```

## Quick start

```bash
# 1. Bootstrap SOPS/age (one-time, on Linux VPS or Linux control host)
./infra/scripts/sops-setup.sh

# 2. Edit encrypted secrets
sops infra/group_vars/all.sops.yml

# 3. Run playbook
ansible-playbook -i infra/inventory/hosts.yml infra/site.yml
```

## Secrets workflow

Secrets are encrypted at rest using SOPS with an age public key. The
age private key lives on the operator machine at `~/.config/sops/age/keys.txt`
(the SOPS default path). It is never committed.

To add or change a secret:
```bash
sops infra/group_vars/all.sops.yml
```

SOPS opens the file in `$EDITOR`, decrypts in memory, and re-encrypts
on save. The committed file contains only ciphertext.

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| `age` | Encryption keypair | `sudo apt install age` |
| `sops` | Encrypted file editing | `scripts/sops-setup.sh` auto-installs, or [manual](https://github.com/getsops/sops/releases) |
| Ansible 2.15+ | Playbook runner | `pip install ansible` |
| `community.sops` | Ansible SOPS integration | `ansible-galaxy collection install community.sops` |

`scripts/sops-setup.sh` is for **Linux VPS bootstrap only**. It
auto-installs `age` (via apt) and `sops` (direct binary download) if
missing (requires `sudo`). macOS operators install `age` and `sops`
separately via their own package manager; this script is not for macOS.

## Fresh Linux control host or VPS bootstrap

A fresh Linux control host or VPS needs:
1. Run `./infra/scripts/sops-setup.sh` — installs `age`/`sops` if missing,
   generates the age keypair, and updates `.sops.yaml`.
2. The age private key transferred securely from an existing operator
   (never over plaintext channels). Path: `~/.config/sops/age/keys.txt`.
3. Ansible 2.15+ with `community.sops` collection:
   `ansible-galaxy collection install community.sops`
4. Set `ansible_host` in `inventory/hosts.yml` to the VPS public IP
   (this is plaintext because Ansible needs it before SOPS decryption).
