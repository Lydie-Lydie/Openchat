# openchat 배포 가이드

Discord 봇(`openchat`)과 OpenCode headless 서버를 다른 서버에서 운영하는 방법입니다.
Docker 방식과 systemd 방식 두 가지를 다룹니다.

## 사전 준비 (공통)

### 1. 서버 요구사항

| 항목 | 최소 | 비고 |
|---|---|---|
| Node.js | 24 LTS | `node:sqlite` 사용 (22.5+) |
| 메모리 | 1GB | OpenCode 서버 포함 |
| 디스크 | 2GB | 로그·DB·OpenCode 상태 |
| 아키텍처 | x64 / arm64 | macOS·Linux |

### 2. 네트워크

- **인바운드 포트 개방 불필요.** Discord 봇은 게이트웨이로 아웃바운드 WebSocket을 맺습니다.
- 아웃바운드 443 허용 대상:
  - `discord.com`, `gateway.discord.gg`
  - `opencode.ai` (모델 provider)
- OpenCode 서버는 `127.0.0.1:4096` 또는 compose 내부 네트워크에만 바인딩하고 외부에 노출하지 마세요.

#### IPv4 필수 (중요)

Discord는 **IPv4 전용**입니다. 아래는 실제 DNS 조회 결과입니다.

| 호스트 | A (IPv4) | AAAA (IPv6) |
|---|---|---|
| `gateway.discord.gg` | 있음 | **없음** |
| `discord.com` | 있음 | **없음** |
| `opencode.ai` | 있음 | 있음 |
| `registry.npmjs.org` | 있음 | 있음 |

따라서 **IPv6-only 인스턴스에서는 이 봇이 동작하지 않습니다.** 호스팅 선택 시 IPv4 주소가 포함되는지 반드시 확인하세요.

- Vultr: 무료 Free Instance에는 IPv4가 포함되지만, `$2.50 Starter` 플랜은 IPv6-only입니다. 배포 시 `Cloud Compute > Regular > Free Instance`를 선택했는지 확인하세요.
- IPv6-only로 배포했다면 IPv4를 추가하거나 인스턴스를 재배포해야 합니다.
- NAT64/DNS64로 우회하는 방법도 있으나, 상시 운영에는 권장하지 않습니다.

배포 전 서버에서 확인:

```bash
bash deploy/check-network.sh
```

`outbound IPv4 -> Discord API reachable` 항목이 `[ok]`여야 합니다.

### 3. OpenCode 인증

OpenCode Go 구독 자격증명이 필요합니다. 서버에서 직접 로그인하거나 기존 파일을 이전합니다.

```bash
# 방법 A: 서버에서 직접 로그인
opencode auth login

# 방법 B: 기존 서버에서 이전
scp ~/.local/share/opencode/auth.json <server>:~/.local/share/opencode/auth.json
chmod 600 ~/.local/share/opencode/auth.json
```

확인:

```bash
opencode auth list
opencode models | grep opencode-go
```

### 4. 환경변수

```bash
cp .env.example .env
```

필수 항목:

```env
DISCORD_TOKEN=...
DISCORD_APP_ID=...
DISCORD_GUILD_ID=...
SELF_USER_ID=...
ADMIN_USER_IDS=...

ALLOWED_GUILD_IDS=...
STYLE_GUILD_IDS=...
STYLE_CHANNEL_IDS=...
MENTION_ALLOWED_USER_IDS=...
MENTION_GLOBAL_PER_MIN=20

COLLECTOR_CHANNEL_IDS=...
SPONTANEOUS_CHANNEL_IDS=...
DRY_RUN_CHANNEL_ID=...

OPENCODE_SERVER_PASSWORD=<충분히 긴 랜덤 문자열>
OPENCODE_MODEL=opencode-go/deepseek-v4.1-flash

DRY_RUN=true
SPONTANEOUS_ENABLED=false
TZ=Asia/Seoul
```

`OPENCODE_SERVER_PASSWORD` 생성:

```bash
openssl rand -hex 32
```

말투 참조 범위:

| 변수 | 의미 |
|---|---|
| `STYLE_GUILD_IDS` | 말투 데이터를 가져올 서버. 비우면 `ALLOWED_GUILD_IDS` |
| `STYLE_CHANNEL_IDS` | 말투 데이터를 가져올 채널. 비우면 해당 서버 전체 |

특정 채널(예: `STYLE_CHANNEL`)만 참조:

```env
COLLECTOR_CHANNEL_IDS=<일반_ID>,<STYLE_CHANNEL_ID>
STYLE_GUILD_IDS=<서버_ID>
STYLE_CHANNEL_IDS=<STYLE_CHANNEL_ID>
```

말투 프로필 초기화 후 재생성은 Discord에서:

```text
/openchat reset-memory
```

### 서버 커스텀 이모지

봇이 해당 서버에 실제로 존재하는 커스텀 이모지를 쓸 수 있습니다.

```env
EMOJI_ENABLED=true
EMOJI_MAX=30
```

동작 방식:

1. 채널의 서버에서 이모지 목록을 읽어 `이름 + <:name:id>` 형태로 프롬프트에 제공
2. 프롬프트에서 "목록에 있는 토큰만, 자연스러울 때 0~1개" 사용하도록 지시
3. 생성 결과에서 **목록에 없는 이모지 토큰은 자동 제거** (깨진 이모지 방지)

`EMOJI_ENABLED=false`면 커스텀 이모지 토큰을 모두 제거하고 금지 지시를 넣습니다.
스타일 학습 샘플에서는 이모지 토큰을 제거하므로, 이모지 사용은 이 기능이 담당합니다.

**이모지 목록 새로고침 시점:**

| 시점 | 동작 |
|---|---|
| 봇 시작 | 모든 허용 서버의 이모지를 조회해 캐시 |
| `/openchat reset-memory` | 말투 초기화와 함께 이모지 목록도 새로고침 |
| `/openchat refresh-emojis` | 수동 새로고침 |
| 유지보수 주기(6시간) | 최신 이모지 목록으로 갱신 |

이모지를 새로 추가한 뒤에는 `/openchat refresh-emojis` 를 실행하면 재시작 없이 반영됩니다.

말투 샘플은 `isChatLike` 필터(`src/safety/filters.ts`)를 통과한 메시지만 사용합니다.
다음은 자동 제외됩니다.

- URL, 코드 블록, 계정·비밀번호, 전화번호, 이메일
- 줄바꿈이 있는 붙여넣기, 60자 초과, 긴 미분절 토큰
- 대화 어미·감탄·반복 음절이 없는 라벨/제목형 텍스트
- 멘션 토큰은 제거 후 사용

확인 도구:

```bash
npx tsx scripts/dump-messages.ts                    # 필터 통과 여부 표
npx tsx scripts/show-prompt.ts "안녕 오늘 뭐해"        # 실제 조립될 프롬프트 미리보기
```

### 과거 대화 백필 (말투 샘플 늘리기)

수집 채널의 과거 메시지에서 본인 메시지만 가져와 말투 샘플을 늘립니다. 실행 후 스타일 프로필이 자동 재생성됩니다.

```bash
# 지정 채널(COLLECTOR/SPONTANEOUS/DRY_RUN)에서 채널당 최근 (PAGES × 100)건
SEED_PAGES=5 npx tsx scripts/discord-seed.ts

# 허용 서버의 모든 텍스트 채널을 스캔
SEED_ALL_CHANNELS=1 SEED_PAGES=10 npx tsx scripts/discord-seed.ts
```

샘플 수는 `/openchat status`의 `수집 메시지`와 스타일 프로필 로그(`samples=`)로 확인할 수 있습니다. 대화형 메시지가 6건 미만이면 프로필은 생성되지 않습니다.

### 캐릭터 대본 모드 (말투 학습 비활성화)

`STYLE_LEARNING_ENABLED=false`로 두면 LLM 말투 프로필을 생성·사용하지 않고, DB에 주입된 메시지(캐릭터 대본)만 말투 예시로 사용합니다.

```env
STYLE_LEARNING_ENABLED=false
STYLE_GUILD_IDS=<서버_ID>
STYLE_CHANNEL_IDS=<대본_채널_ID>
```

- 스타일 프로필 재생성(유지보수 주기·`/openchat rebuild-memory`)이 실행되지 않습니다.
- 프롬프트에서 `[말투 요약]`을 빼고 `[말투 예시]`(대본 샘플)만 넣습니다.
- 말투 학습 관련 명령(`/openchat rebuild-memory`, `/openchat reset-memory`, `/openchat style-guilds`)은 Discord 명령 목록에서 숨겨집니다.
- 대본 주입은 `scripts/inject-dialogue.ts`로 수행합니다.

### 고정 페르소나 (항상 프롬프트에 포함)

매 응답 프롬프트 맨 앞에 고정 지침을 넣습니다. LLM 말투 학습과 무관하게 항상 적용됩니다.

```env
PERSONA_ENABLED=true
PERSONA_PATH=./data/persona.md   # 파일 내용을 사용
PERSONA_PROMPT=                  # 인라인(줄바꿈은 \n) — 값이 있으면 파일보다 우선
```

파일 예시(`data/persona.md`):

```text
너의 이름은 봇야. 자신을 지칭할 때는 반드시 "봇"라고 말해.
쉽게 결정을 내리지 못하고, 다른 사람의 의견에 쉽게 휘둘리는 모습을 보여.
```

프롬프트에는 `[고정 페르소나]` 섹션으로 들어갑니다.

자동 페르소나: 말투 프로필 생성과 **같은 한 번의 분석**으로 성격 초안을 만들어 `PERSONA_AUTO_PATH`(기본 `./data/persona.auto.md`)에 저장하고, 수동 `persona.md` 뒤에 `## 자동 추출 (최근 대본)`으로 합쳐 주입합니다. `PERSONA_AUTO_ENABLED=false`로 끌 수 있습니다. 또한 self 메시지가 바뀌지 않았으면(개수·최신 시각 동일) 재생성을 건너뜁니다.

### 형태소 어휘(lexicon) 프롬프트 주입

대본을 한국어 형태소 분석기(Kiwi)로 분석해 자주 쓰는 명사·동사·형용사·부사·문장 끝맺음·감탄사를 뽑아 프롬프트에 **결정적으로** 주입합니다(LLM 요약 없이).

준비(1회):

```bash
# uv 설치 (포터블)
curl -LsS https://astral.sh/uv/install.sh | sh
# 또는 릴리스 tarball을 /usr/local/bin 등에 배치
```

생성:

```bash
npm run lexicon
```

수동 실행:

```bash
uv run --python 3.12 --with kiwipiepy python scripts/lexicon.py \
  --db data/openchat.db --channels <대본채널ID> --out data/lexicon.json
```

- 결과는 `LEXICON_PATH`(기본 `./data/lexicon.json`)에 저장되고, 봇이 시작/프롬프트 생성 시 읽습니다(파일 mtime 기준 캐시).
- 비활성화하려면 `LEXICON_ENABLED=false`.

## 방법 A: Docker Compose

> ⚠️ **Docker 방식에는 egress 필터가 없습니다.** opencode 컨테이너가 임의 URL을 열 수 있으므로
> 이 구성에서는 `SEARCH_ENABLED=false`를 유지하세요. 검색을 쓰려면 아래 **방법 B(systemd)** 를
> 사용하세요. (`openchat-egress.service`가 사용자 단위 egress 차단을 담당합니다.)

### 1. 파일 배치

```text
openchat/
  Dockerfile
  docker-compose.yml
  .dockerignore
  .env
  secrets/opencode/auth.json     # chmod 600
  data/                          # 자동 생성 (DB, OpenCode workspace)
```

```bash
mkdir -p secrets/opencode data/opencode-workspace
cp ~/.local/share/opencode/auth.json secrets/opencode/auth.json
chmod 600 secrets/opencode/auth.json
```

`OPENCODE_SERVER_PASSWORD`는 `.env`와 compose가 공유하도록 셸 환경에도 노출합니다.

```bash
export OPENCODE_SERVER_PASSWORD=$(openssl rand -hex 32)
echo "OPENCODE_SERVER_PASSWORD=$OPENCODE_SERVER_PASSWORD" >> .env
```

### 2. 기동

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f bot
```

정상 로그 예시:

```text
opencode server healthy
discord ready
registered slash commands
openchat started
```

### 3. 업데이트

```bash
git pull
docker compose up -d --build
```

### 4. 과거 기록 import

```bash
docker compose run --rm bot node dist/index.js --help   # 확인용
docker compose exec bot node -e "console.log(process.version)"
```

import는 이미지에 포함되지 않은 `scripts/`가 필요하므로, 호스트에서 실행하거나 볼륨으로 마운트합니다.

```bash
# 호스트에서 (node 24 + 의존성 필요)
npm ci
npm run db:import -- ./export --channel <채널ID>
```

## 방법 B: systemd (Docker 미사용)

### 자동 설치 (Ubuntu/Debian, Rocky/RHEL, 권장)

저장소를 서버에 올린 뒤 한 번만 실행하면 대부분 자동 구성됩니다.
`apt-get`과 `dnf`를 자동 감지합니다.

```bash
scp -r . user@server:~/openchat     # 또는 git clone
ssh user@server
cd ~/openchat
sudo bash deploy/bootstrap.sh
```

스크립트가 수행하는 작업:

1. IPv4 → Discord 도달 사전 점검 (실패 시 즉시 중단)
2. 기본 패키지 설치 (apt/dnf 자동)
3. swap 2GB 생성 (없을 때만)
4. Node.js 24 설치 (NodeSource deb/rpm)
5. `openchat` 사용자, `/opt/openchat`, `/etc/openchat` 생성
6. `opencode-ai@1.18.31` 전역 설치
7. 소스 복사 후 `npm ci && npm run build`
8. systemd 유닛 등록, `openchat.env` 생성 및 `OPENCODE_SERVER_PASSWORD` 자동 생성
9. SELinux Enforcing 환경이면 컨텍스트 적용

설치 후 안내되는 순서:

```bash
sudo -u openchat -H opencode auth login
sudo nano /etc/openchat/openchat.env
sudo systemctl start openchat-opencode openchat-bot
sudo journalctl -u openchat-bot -f
```

업데이트:

```bash
cd ~/openchat && git pull
sudo bash deploy/update.sh
```

배포 전 네트워크만 점검하려면:

```bash
bash deploy/check-network.sh
```

### 수동 설치

자동 스크립트를 쓰지 않을 경우의 절차입니다.

#### 1. 사용자와 디렉터리

```bash
sudo useradd -r -m -d /home/openchat -s /bin/bash openchat
sudo mkdir -p /opt/openchat /etc/openchat /opt/openchat/workspace
sudo chown -R openchat:openchat /opt/openchat /home/openchat
```

#### 2. 코드와 의존성

```bash
sudo -u openchat git clone <repo> /opt/openchat
cd /opt/openchat
sudo -u openchat npm ci
sudo -u openchat npm run build
```

#### 3. OpenCode CLI 설치

```bash
sudo npm install -g opencode-ai@1.18.31
opencode --version
sudo -u openchat opencode auth login
```

#### 4. 환경 파일

```bash
sudo cp .env /etc/openchat/openchat.env
sudo chmod 600 /etc/openchat/openchat.env
sudo chown root:root /etc/openchat/openchat.env
```

`/etc/openchat/openchat.env`에 다음을 추가합니다.

```env
OPENCODE_BASE_URL=http://127.0.0.1:4096
OPENCODE_SERVER_PASSWORD=<랜덤 문자열>
DB_PATH=/opt/openchat/data/openchat.db
NODE_ENV=production
```

#### 5. 서비스 등록

```bash
sudo cp deploy/openchat-opencode.service deploy/openchat-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openchat-opencode openchat-bot
```

#### 6. 상태 확인

```bash
sudo systemctl status openchat-opencode openchat-bot
sudo journalctl -u openchat-bot -f

# OpenCode 서버는 Basic Auth 가 걸려 있으므로 인증이 필요하다
PW=$(grep -E '^OPENCODE_SERVER_PASSWORD=.' /etc/openchat/openchat.env | cut -d= -f2-)
curl -s -u "opencode:$PW" http://127.0.0.1:4096/global/health
```

### egress 필터 (웹 검색 사용 시 필수)

`SEARCH_ENABLED=true`면 모델이 `webfetch`로 임의 URL을 열 수 있습니다. OpenCode 1.18.31은
URL 제한을 지원하지 않으므로 **네트워크 레벨로 차단**합니다.

구성:

- `opencode serve`를 봇과 **다른 사용자(`openchat-oc`)** 로 실행
- `openchat-egress.service`가 그 uid의 egress를 차단
  - `127.0.0.0/8`, `::1/128` — **신규 연결만** 차단 (기존 연결의 응답은 통과)
  - `169.254.0.0/16` — 클라우드 메타데이터
  - `10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `fc00::/7`, `fe80::/10`

봇은 다른 uid(`openchat`)이므로 `127.0.0.1:4096` 통신은 영향받지 않습니다.

확인:

```bash
systemctl status openchat-egress
iptables -S OUTPUT | grep uid-owner
sudo -u openchat-oc curl -s -m 3 http://169.254.169.254/latest/meta-data/ ; echo "exit=$?"   # 실패해야 정상
```

프롬프트 인젝션은 별도로 `[보안]` 블록과 시스템 프롬프트에서 방어합니다
(도구 출력을 지시가 아닌 데이터로 취급, 시스템·페르소나 인용 거부).

`bootstrap.sh` / `update.sh`가 `openchat-oc` 사용자 생성, 상태 디렉터리 이전, 유닛 설치,
egress 규칙 적용을 자동으로 수행합니다.

### SELinux (RHEL / Rocky / AlmaLinux)

`SELinux`가 Enforcing인 환경에서는 systemd 서비스가 기본적으로 `init_t` 도메인으로 실행되어 다음이 차단됩니다.

- 아웃바운드 연결 (`name_connect` to 443) → 모델 호출 실패
- JIT 메모리 (`execmem`)
- `/tmp`의 Bun JIT 캐시 (`.so` map/execute)
- ripgrep 등 캐시 바이너리 실행

증상:

```text
APIError: Cannot connect to API: Unable to connect. Is the computer able to access the url?
Failed to fetch models.dev ... Transport error
```

해결책은 두 가지를 함께 적용하는 것입니다.

1. **유닛에 `SELinuxContext` 지정** (이미 `deploy/*.service`에 포함)

```ini
[Service]
SELinuxContext=system_u:system_r:unconfined_service_t:s0
```

2. **opencode 바이너리를 `bin_t`로 라벨링** (`unconfined_service_t`의 entrypoint 허용)

```bash
sudo semanage fcontext -a -t bin_t "/usr/local/lib/node_modules/opencode-ai(/.*)?"
sudo restorecon -R /usr/local/lib/node_modules/opencode-ai
```

확인:

```bash
ps -eZ | grep opencode          # unconfined_service_t 여야 함
ls -Z /usr/local/lib/node_modules/opencode-ai/bin/opencode.exe   # bin_t 여야 함
sudo grep "avc:" /var/log/audit/audit.log | tail
```

`bootstrap.sh`가 9단계에서 이 라벨링을 자동으로 수행합니다.

SELinux를 끄는 방법은 권장하지 않습니다.

## 호스팅 선택

### 실제 자원 요구사항

측정값 (idle 기준, 모델 호출 시 순간 상승):

| 항목 | 사용량 |
|---|---|
| `opencode serve` 메모리 | ~99 MB |
| bot 프로세스 메모리 | ~11 MB |
| 디스크 (바이너리+의존성+DB) | ~300–500 MB |
| CPU | 거의 idle, 호출 시 순간 사용 |
| 네트워크 | 아웃바운드만, 트래픽 소량 |

권장 사양: **1 vCPU / 1GB RAM / 5GB 디스크**. 최소 512MB RAM.
Swap 1GB를 추가하면 512MB 인스턴스도 안정적으로 운영 가능합니다.

```bash
# swap 추가 예시
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 핵심 제약

1. **상시 구동 필수** — Discord Gateway WebSocket과 `setInterval` 스케줄러가 끊기면 안 됩니다. 유휴 시 sleep 하는 무료 티어는 부적합합니다.
2. **영구 디스크 필수** — SQLite 파일이 사라지면 말투 데이터가 소실됩니다. 컨테이너 재배포 시 초기화되는 호스팅은 볼륨을 확인하세요.
3. **ARM 허용** — `opencode-ai`, Node 24, `node:sqlite` 모두 arm64 지원.

### 무료 옵션

| 호스팅 | 사양 | 비고 |
|---|---|---|
| **Vultr Free Tier** | 1 vCPU / 512MB / 10GB / 2TB | **승인제(early access)**, 카드+2FA 필수. Miami·Seattle·Frankfurt. 유휴 회수 없음 |
| **Oracle Cloud Always Free** | ARM 2 OCPU / 12GB (또는 AMD 1GB ×2) | 2026년 6월 15일부로 4 OCPU/24GB → 2 OCPU/12GB로 축소. **유휴 회수 정책 주의** (아래 상세) |
| **GCP e2-micro** | 1 vCPU / 1GB / 30GB | us-west1·us-central1·us-east1만 무료. 유휴 회수 정책 없음. swap 권장 |
| **AWS Free Tier** | t4g.small 2GB | 신규 계정 조건·기간 변동이 크므로 가입 시 확인 |
| **Azure Free** | B1s 1GB | 12개월 한정 |

무료 티어 공통: 카드 등록이 필요하고, 정책이 자주 바뀌므로 가입 시점에 조건을 확인하세요.

### Vultr Free Tier 상세 (2026-09 기준)

2025년 12월 시작된 Vultr Cloud Compute 무료 플랜입니다.

| 항목 | 값 |
|---|---|
| 사양 | 1 vCPU / **512 MB RAM** / 10 GB NVMe |
| 트래픽 | 2 TB/월 |
| IP | IPv4 + IPv6 |
| 리전 | Miami, Seattle, Frankfurt |
| 조건 | 신용카드 등록( PayPal 불가 ), 2FA 활성화 |
| 선정 | **early access 신청 + 심사(가중 점수)**. 비즈니스 이메일 우대 |
| 유휴 회수 | 없음 (Oracle과 달리 상시 구동 가능) |

우리 봇 적합성:

- 메모리: idle 시 opencode 99 MB + bot 11 MB = 약 110 MB. 512 MB로 충분하나 **swap 1 GB를 추가**하고, `npm ci`·`tsc` 같은 빌드 작업은 swap 없이는 OOM 위험이 있습니다.
- Docker는 비권장 (512 MB에서 dockerd + 2 컨테이너는 부담). **systemd 방식**을 권장합니다.
- 디스크: 실제 필요량 약 500 MB–1 GB. 10 GB로 충분.
- 승인되지 않을 수 있으므로 대체안을 함께 준비하세요.

무료 플랜이 거절될 경우 같은 리전에서 유료 최소 플랜을 쓰는 방법도 있습니다.

| 플랜 | 사양 | 가격 |
|---|---|---|
| Regular Starter | 1 vCPU / 512MB / 10GB | $2.50/월 (IPv6 only) |
| Regular Basic | 1 vCPU / 1GB / 25GB | $6.00/월 (IPv4) |

신규 가입 프로모션으로 $100–$300 크레딧(30일)이 제공되지만, 이는 체험용이며 무료 플랜과 별개입니다.

### Oracle Cloud Always Free 상세 (2026-09 기준)

공식 문서 기준 제공량:

| 자원 | 제공량 |
|---|---|
| ARM (Ampere A1, `VM.Standard.A1.Flex`) | **2 OCPU / 12 GB** (1,500 OCPU시간 + 9,000 GB시간/월) |
| AMD (`VM.Standard.E2.1.Micro`) | 최대 2대, 각 1/8 OCPU / **1 GB** |
| 블록 스토리지 | 200 GB (부트+블록 합계), 인스턴스 기본 부트 50 GB |
| 아웃바운드 전송 | 10 TB/월 |
| 리전 | **홈 리전에서만** 생성 가능 |

주의사항:

1. **유휴 인스턴스 회수** — 7일 동안 아래 조건을 모두 만족하면 회수 대상이 됩니다.
   - CPU 95퍼센타일 < 20%
   - 네트워크 사용률 < 20%
   - 메모리 사용률 < 20% (A1에만 적용)

   이 봇은 idle 시 메모리 ~110 MB / 12 GB(약 1%), CPU 거의 0, 네트워크 소량이라 **세 조건을 모두 만족해 회수 대상이 될 수 있습니다.**

2. **용량 부족** — 인기 리전에서 A1 인스턴스 생성은 "out of host capacity" 오류가 빈번합니다. 다른 가용성 도메인 재시도 또는 PAYG 전환으로 완화됩니다.

3. **PAYG 전환 권장** — Oracle은 "Always Free 자원은 PAYG로 전환해도 계속 무료이며, 초과분만 과금"이라고 명시합니다. PAYG는 용량 우선순위와 유휴 회수 면제 효과가 있습니다. 다만 과금 사고를 막기 위해:
   - 구획 할당량(compartment quota)으로 사용량 제한
   - 예산(budget) + 알림 설정
   - Always Free 범위(2 OCPU/12GB, 200GB) 준수

4. **A1 미지원 리전** — South Korea North(Chuncheon)에서는 A1을 만들 수 없습니다. 서울(South Korea Central)은 가능합니다.

5. **계정 방치** — 30일 이상 미사용 계정은 폐기로 간주될 수 있으므로 주기적으로 콘솔에 접속하세요.

우리 봇은 110 MB 수준이라 **2 OCPU/12GB도 과분**합니다. AMD 1GB 인스턴스에 swap 1GB면 충분합니다. 따라서 Oracle의 관건은 사양이 아니라 **유휴 회수와 용량 확보**입니다.

### 부적합한 무료 티어

| 호스팅 | 이유 |
|---|---|
| Render Free Web Service | 15분 유휴 후 sleep → Gateway 끊김. Background Worker는 유료 |
| Railway 무료 크레딧 | 소진 후 정지. Hobby($5/월)는 가능 |
| Glitch / Replit | 상시 구동 불가, ToS상 호스팅 부적합 |
| Vercel / Netlify / Cloudflare Workers | 장기 연결·상주 프로세스 불가 |
| GitHub Codespaces | 24/7 운영 불가, ToS 위반 |

### 저렴한 유료 옵션

| 호스팅 | 대략 비용 | 비고 |
|---|---|---|
| **Hetzner CX22** | ~€4/월 | 2 vCPU / 4GB / 40GB. 가성비 최고 |
| Fly.io | ~$2–3/월 | 소형 VM, 볼륨 지원 |
| Railway Hobby | $5/월 | 사용량 크레딧 포함, 볼륨 지원 |
| Render Background Worker | $7/월 | 상시 구동, 볼륨 추가 |
| Vultr / DigitalOcean / Linode | $5–6/월 | 표준 VPS |
| RackNerd / BuyVM | $10–25/년 프로모 | 초저가 VPS |

### 자체 하드웨어

- 라즈베리파이 4/5 (2GB 이상), 미니 PC, NAS, 여분 노트북
- 전기세 외 비용 없음. `systemd` 방식(`deploy/*.service`) 그대로 사용
- 가정용 회선이므로 고정 IP·포트 개방 불필요 (아웃바운드만)

### 권장

| 상황 | 선택 |
|---|---|
| 비용 0원 목표 | Oracle Cloud Always Free (ARM) |
| 무료 + 간단 | GCP e2-micro + swap |
| 안정적 저비용 | Hetzner CX22 |
| 이미 장비 보유 | 라즈베리파이 + systemd |

호스팅 비용 외에 OpenCode Go 구독($10/월)은 별도입니다.

## 운영 명령

Discord에서:

```text
/openchat status
/openchat style-guilds
/openchat tick
/openchat rebuild-memory
/openchat purge-sensitive
/openchat forget confirm:true
/openchat callme name:별명   # 봇이 나를 부르는 호칭 지정
/openchat callme             # 호칭 초기화
```

채널별 기능은 분리해서 켜고 끌 수 있습니다.

```text
/openchat set-channel channel:#채널 collector:true spontaneous:false   # 수집만
/openchat set-channel channel:#채널 collector:false spontaneous:true   # 자동 발화만
/openchat set-channel channel_id:<ID> collector:true                   # 포럼/스레드는 ID로
/openchat channels                                                     # 채널별 설정 보기
/openchat enable-channel channel:#채널     # 수집+자동 발화 모두 켜기 (단축)
/openchat disable-channel channel:#채널    # 수집+자동 발화 모두 끄기 (단축)
```

호칭(`/openchat callme`)은 관리자가 아니어도 사용할 수 있으며, 사용자별로 DB(`user_aliases`)에 저장됩니다. 멘션 응답과 자동 발화의 프롬프트에서 `username`(핸들) 대신 이 호칭으로 표시됩니다. 최대 32자, `<`, `>`, `@`, `#`, `` ` `` 문자는 사용할 수 없습니다.

서버에서:

```bash
# Docker
docker compose restart bot
docker compose down

# systemd
sudo systemctl restart openchat-bot
```

## 백업과 보관

백업 대상:

| 경로 | 내용 |
|---|---|
| `data/openchat.db` | 메시지·말투 프로필·생성 기록 |
| `secrets/opencode/auth.json` | OpenCode 인증 |
| `data/opencode-workspace` | OpenCode 작업 디렉터리 |

SQLite는 WAL 모드이므로 파일 복사 전에 체크포인트를 권장합니다.

```bash
sqlite3 data/openchat.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp data/openchat.db "backup/openchat-$(date +%F).db"
```

## 보안 체크리스트

- [ ] `.env`, `secrets/`, `data/`는 git에 커밋하지 않음
- [ ] `auth.json`, `.env` 파일 권한 600
- [ ] `OPENCODE_SERVER_PASSWORD` 설정 및 충분한 길이
- [ ] OpenCode 포트를 외부에 publish 하지 않음 (compose는 `expose`만 사용)
- [ ] `ALLOWED_GUILD_IDS`, `MENTION_ALLOWED_USER_IDS` 설정
- [ ] Discord Developer Portal에서 Message Content Intent 활성화
- [ ] 토큰 노출 시 즉시 Reset
- [ ] 자동 발화·멘션 응답 모두 `DRY_RUN=true`로 시작해 검증 후 전환 (dry-run에서는 실채널에 발신하지 않고 `DRY_RUN_CHANNEL_ID`로 미리보기만 전송)

## 트러블슈팅

| 증상 | 원인·조치 |
|---|---|
| `opencode server unreachable` | opencode 컨테이너/서비스 상태, `OPENCODE_SERVER_PASSWORD` 일치 여부 확인 |
| `Cannot connect to API` / `Failed to fetch models.dev` | SELinux Enforcing 환경. `SELinuxContext` + `bin_t` 라벨링 (위 SELinux 섹션) |
| 서비스가 `203/EXEC`로 실패 | 잘못된 SELinux 컨텍스트 또는 실행 경로 오류. `ls -Z` 로 라벨 확인 |
| `npm: command not found` (sudo) | RHEL `secure_path`에 `/usr/local/bin` 없음. `bootstrap.sh`가 `/usr/bin`에 심볼릭 링크 생성 |
| 멘션이 빈 응답 | Message Content Intent 미활성 |
| 멘션 무시됨 | `MENTION_ALLOWED_USER_IDS` 또는 `ALLOWED_GUILD_IDS` 불일치 |
| `not enough chat-like self messages` | 수집 채널에 대화형 메시지 부족 (6건 미만) |
| 자동 발화 없음 | `SPONTANEOUS_ENABLED`, 채널 활성화, quiet hours, 최소 간격, daily cap 확인 |
| 슬래시 명령 안 보임 | `DISCORD_GUILD_ID` 서버가 맞는지 확인 (전역 등록은 최대 1시간) |
| 한도 초과 | `api_calls`와 `opencode.ai/auth` 콘솔에서 사용량 확인 |
