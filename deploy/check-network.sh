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
echo "== 서비스 =="
for svc in openchat-egress openchat-opencode openchat-bot; do
  if systemctl is-active "$svc" >/dev/null 2>&1; then
    pass "$svc active"
  else
    fail "$svc not active"
  fi
done

echo
echo "== egress 필터 (opencode 사용자) =="
V4="$(iptables -S OUTPUT 2>/dev/null | grep -c 'uid-owner' || true)"
V6="$(ip6tables -S OUTPUT 2>/dev/null | grep -c 'uid-owner' || true)"
if [ "${V4:-0}" -gt 0 ]; then
  pass "IPv4 OUTPUT 규칙 ${V4}개"
else
  fail "IPv4 OUTPUT 규칙 없음 (검색 사용 시 위험)"
fi
if [ "${V6:-0}" -gt 0 ]; then
  pass "IPv6 OUTPUT 규칙 ${V6}개"
else
  fail "IPv6 OUTPUT 규칙 없음"
fi

OC_USER="${OC_USER:-${APP_USER:-openchat}-oc}"
if id -u "$OC_USER" >/dev/null 2>&1; then
  if sudo -u "$OC_USER" timeout 4 bash -c 'exec 3<>/dev/tcp/169.254.169.254/80' 2>/dev/null; then
    fail "$OC_USER 가 메타데이터(169.254.169.254)에 접속됨 — 필터 확인 필요"
  else
    pass "$OC_USER 의 메타데이터 접속 차단됨"
  fi
  if sudo -u "$OC_USER" timeout 4 bash -c 'exec 3<>/dev/tcp/127.0.0.1/4096' 2>/dev/null; then
    fail "$OC_USER 가 loopback:4096 에 신규 접속됨 — 필터 확인 필요"
  else
    pass "$OC_USER 의 loopback 신규 접속 차단됨"
  fi
fi

echo
echo "결론: 'outbound IPv4 -> Discord' ok, 'egress 필터' ok 여야 합니다."
