#!/usr/bin/env bash
# Adds a 2 GB swap file (safety net for memory peaks on a 1 GB server).
# Run once: sudo bash deploy/setup-swap.sh
set -euo pipefail

if swapon --show | grep -q /swapfile; then
  echo "Swap already set up:"; swapon --show; exit 0
fi
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Prefer RAM; use swap only under pressure.
sysctl -w vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
echo "Done:"; swapon --show; free -h
