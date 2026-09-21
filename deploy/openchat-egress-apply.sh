#!/usr/bin/env bash
# Blocks the opencode user from reaching loopback, link-local and private
# networks, so a model-driven webfetch cannot hit the opencode server itself,
# cloud metadata (169.254.169.254) or other hosts in the VPC.
#
# The bot runs as APP_USER, so the bot <-> opencode connection on 127.0.0.1:4096
# is unaffected. Loopback only blocks NEW outbound connections for the opencode
# user, which leaves established replies flowing.
set -euo pipefail

APP_USER="${APP_USER:-openchat}"
OC_USER="${OC_USER:-${APP_USER}-oc}"
if ! id -u "$OC_USER" >/dev/null 2>&1; then
  echo "user $OC_USER not found" >&2
  exit 1
fi
OC_UID="$(id -u "$OC_USER")"

add4() {
  local dest="$1"
  shift
  iptables -C OUTPUT -m owner --uid-owner "$OC_UID" -d "$dest" "$@" -j REJECT 2>/dev/null \
    || iptables -I OUTPUT 1 -m owner --uid-owner "$OC_UID" -d "$dest" "$@" -j REJECT
}

add6() {
  local dest="$1"
  shift
  ip6tables -C OUTPUT -m owner --uid-owner "$OC_UID" -d "$dest" "$@" -j REJECT 2>/dev/null \
    || ip6tables -I OUTPUT 1 -m owner --uid-owner "$OC_UID" -d "$dest" "$@" -j REJECT
}

# Loopback: block only NEW connections so replies on established ones still work.
add4 127.0.0.0/8 -m conntrack --ctstate NEW
add6 ::1/128 -m conntrack --ctstate NEW

# Link-local (cloud metadata) and private ranges.
add4 169.254.0.0/16
add4 10.0.0.0/8
add4 172.16.0.0/12
add4 192.168.0.0/16
add4 100.64.0.0/10
add6 fe80::/10
add6 fc00::/7

echo "openchat egress filter applied for uid ${OC_UID} (${OC_USER})"
