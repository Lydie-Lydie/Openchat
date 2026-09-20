#!/usr/bin/env bash
set -u

pass() { printf '  [ok]   %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; }

echo "== global addresses =="
ip -4 -o addr show scope global 2>/dev/null | awk '{print "  IPv4 " $4}' || echo "  (ip 명령 없음)"
ip -6 -o addr show scope global 2>/dev/null | awk '{print "  IPv6 " $4}' || true

echo
echo "== outbound IPv4 =="
if curl -4 -sS -m 8 -o /dev/null -w '  discord.com   HTTP %{http_code}\n' https://discord.com/api/v10/gateway; then
  pass "Discord API reachable over IPv4"
else
  fail "Discord API NOT reachable over IPv4"
fi

echo
echo "== outbound IPv6 =="
if curl -6 -sS -m 8 -o /dev/null -w '  opencode.ai   HTTP %{http_code}\n' https://opencode.ai/; then
  pass "opencode.ai reachable over IPv6"
else
  fail "opencode.ai NOT reachable over IPv6"
fi

if curl -6 -sS -m 8 -o /dev/null https://discord.com/api/v10/gateway 2>/dev/null; then
  pass "Discord reachable over IPv6"
else
  fail "Discord NOT reachable over IPv6 (expected: Discord has no AAAA record)"
fi

echo
echo "== DNS records =="
if getent ahostsv4 gateway.discord.gg >/dev/null 2>&1; then
  pass "gateway.discord.gg has A (IPv4)"
else
  fail "gateway.discord.gg has no A record"
fi
if getent ahostsv6 gateway.discord.gg >/dev/null 2>&1; then
  pass "gateway.discord.gg has AAAA (IPv6)"
else
  fail "gateway.discord.gg has no AAAA (Discord is IPv4 only)"
fi

echo
echo "결론: 위 'outbound IPv4 -> Discord' 가 ok 여야 봇이 동작합니다."
