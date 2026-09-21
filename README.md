# openchat

개인 Discord 서버용 **말투 학습 챗봇**. 지정한 사용자(`SELF_USER_ID`)의 메시지를 수집해 말투·페르소나를 학습하고, 멘션에 그 사람의 말투로 답합니다. 모델 호출은 **OpenCode headless 서버**(`opencode serve`)를 게이트웨이로 사용합니다.

> 이 저장소에는 수집된 대사/페르소나/어휘 등 **개인 데이터가 포함되지 않습니다.** 런타임 데이터는 `data/`에 생성되며 `.gitignore`로 제외됩니다.

## 주요 기능

- **멘션 응답**: 멘션/봇에 대한 답글에 응답. 기본은 채널 인라인 답장(설정 시 스레드 생성).
- **답글 컨텍스트**: 봇 메시지에 대한 답글이면 원문(체인 최대 3개)을 컨텍스트에 포함.
- **말투 학습**(선택): 수집 메시지를 LLM으로 요약한 말투 프로필(`STYLE_LEARNING_ENABLED`).
- **형태소 어휘**(선택): 한국어 형태소 분석(Kiwi)으로 주어/목적어/서술어·어말어미·문장구조 추출(`LEXICON_ENABLED`).
- **페르소나**: 수동 `data/persona.md` + 자동 추출 `data/persona.auto.md`(말투 분석 시 함께 생성).
- **자동 발화**(선택): 채널별 스케줄러, dry-run/조용시간/최소간격/일일한도.
- **반복 방지**: 최근 답변을 프롬프트에 넣고 유사도 검사로 중복 시 재생성.
- **웹 검색**(선택, 기본 OFF): 내부 자료로 답할 수 없을 때만 OpenCode의 `websearch`/`webfetch` 도구 사용(`SEARCH_ENABLED`).
  - OpenCode 1.18.31은 fetch URL 제한을 지원하지 않으므로 **네트워크 레벨로 차단**합니다. `opencode serve`를 봇과 다른 사용자로 실행하고 `openchat-egress.service`가 그 uid의 loopback(신규 연결만)·link-local(`169.254.0.0/16`, 클라우드 메타데이터)·사설 대역 egress를 막습니다. 봇은 다른 uid라 `127.0.0.1:4096` 통신에 영향이 없습니다.
  - 프롬프트는 도구 출력을 **신뢰할 수 없는 데이터**로 취급하도록 지시합니다(인젝션 방어).
  - 잔여 위험: 허용된 공개 도메인으로 컨텍스트를 URL에 실어 보내는 유출은 여전히 가능하므로, 통제하지 않는 서버에서는 켜지 마세요. 자세한 내용은 `src/opencode/tools.ts`.
- **반응 컨텍스트**: 최근 메시지의 이모지 반응과 반응한 사람을 컨텍스트에 포함(메모리만, DB 미저장).
- **사용자별 호칭**: `/openchat callme`로 봇이 부르는 이름 지정.
- **채널 기능 분리**: 수집과 자동 발화를 채널별로 개별 ON/OFF, 포럼/스레드 지원.

## 요구사항

- Node.js 24+ (내장 `node:sqlite` 사용)
- [OpenCode](https://opencode.ai) CLI 및 구독 자격증명 (`opencode auth login`)
- Python 3.12 + [uv](https://docs.astral.sh/uv/) (형태소 어휘 생성 시, `scripts/lexicon.py`)
- IPv4 아웃바운드(Discord/OpenCode 접속). 자세한 배포 요구사항은 `DEPLOY.md` 참고

## 빠른 시작

```bash
# 1) 의존성 · 빌드
npm ci
npm run build

# 2) 환경 변수
cp .env.example .env
#   DISCORD_TOKEN, DISCORD_APP_ID, SELF_USER_ID, ADMIN_USER_IDS,
#   ALLOWED_GUILD_IDS, OPENCODE_SERVER_PASSWORD 등 설정

# 3) OpenCode 인증 (최초 1회)
opencode auth login

# 4) 실행
npm start
```

systemd 배포 스크립트/유닛은 `deploy/`에 있습니다(`bootstrap.sh`, `update.sh`, `*.service`). 자세한 내용은 `DEPLOY.md`.

### 형태소 어휘 생성 (선택)

```bash
npm run lexicon
# 내부: uv run --python 3.12 --with kiwipiepy python scripts/lexicon.py --db <DB> --out data/lexicon.json
```

## 주요 환경 변수

| 변수 | 설명 |
|---|---|
| `BOT_NAME` | 봇/세션/스레드에 표시되는 이름(기본 `openchat`) |
| `COMMAND_NAME` | 슬래시 명령 이름(기본 `openchat`) |
| `DISCORD_TOKEN`, `DISCORD_APP_ID` | 봇 토큰/애플리케이션 ID |
| `SELF_USER_ID` | **학습 대상** 사용자 ID (이 사람의 메시지만 수집) |
| `ADMIN_USER_IDS` | 관리자 ID(쉼표 구분) |
| `ALLOWED_GUILD_IDS` | 동작할 서버 ID(비우면 모든 서버) |
| `STYLE_GUILD_IDS`, `STYLE_CHANNEL_IDS` | 말투 참조 범위(비우면 `ALLOWED_GUILD_IDS` 전체) |
| `COLLECTOR_CHANNEL_IDS`, `SPONTANEOUS_CHANNEL_IDS` | 수집/자동발화 채널(쉼표 구분) |
| `DRY_RUN` | `true`면 실채널 발신 없이 미리보기만 |
| `STYLE_LEARNING_ENABLED` | LLM 말투 프로필 생성/사용 |
| `LEXICON_ENABLED`, `LEXICON_PATH` | 형태소 어휘 주입/경로 |
| `PERSONA_ENABLED`, `PERSONA_PATH`, `PERSONA_PROMPT` | 고정 페르소나 |
| `PERSONA_AUTO_ENABLED`, `PERSONA_AUTO_PATH` | 자동 추출 페르소나 |
| `MENTION_REPLY_INLINE` | `true`면 채널 인라인 답장(기본), `false`면 스레드 생성 |
| `MENTION_GLOBAL_PER_MIN` | 전역 멘션 레이트리밋 |
| `EMOJI_ENABLED`, `EMOJI_MAX` | 서버 커스텀 이모지 사용 |
| `SEARCH_ENABLED` | 내부 자료로 답할 수 없을 때 웹 검색 (egress 필터 필요) |
| `OPENCODE_BASE_URL`, `OPENCODE_SERVER_USERNAME/PASSWORD` | OpenCode 서버 접속 |
| `OPENCODE_MODEL*`, `OPENCODE_TIMEOUT_MS` | 모델/타임아웃 |
| `DB_PATH`, `RETENTION_DAYS`, `TZ` | DB 경로/보존/시간대 |

## 명령

관리자 명령은 `/openchat`입니다. (`/openchat callme`은 모든 사용자)

```
/openchat status
/openchat set-channel channel:#채널 collector:true spontaneous:false   # 기능 개별 제어
/openchat channels
/openchat enable-channel / disable-channel                            # 수집+자동발화 일괄
/openchat set-interval minutes:60
/openchat tick                                                        # 즉시 1회 실행(현재 채널)
/openchat dryrun enabled:true
/openchat rebuild-memory / reset-memory / style-guilds                 # 학습 명령(학습 ON일 때)
/openchat callme name:호칭
/openchat forget confirm:true / purge-sensitive
```

## 스크립트

| 명령 | 용도 |
|---|---|
| `npm run lexicon` | 형태소 어휘 생성 |
| `npm run db:import -- <파일/디렉터리> [--channel id] [--assume-self]` | 과거 메시지 임포트 |
| `npx tsx scripts/discord-seed.ts` | 채널/스레드 과거 메시지 백필(`SEED_ALL_CHANNELS=1 SEED_PAGES=N`) |
| `npx tsx scripts/show-prompt.ts "질문"` | 실제 조립될 프롬프트 미리보기 |
| `npx tsx scripts/preview-mention.ts "질문"` | 생성 결과 미리보기 |
| `npm run test` | 테스트 |

## 디렉터리 구조

```
src/
  index.ts              # 부팅
  config.ts             # 환경변수 스키마
  db/                   # SQLite, 마이그레이션, 쿼리
  discord/              # 클라이언트, 수집기, 멘션 핸들러, 명령, 컨텍스트
  opencode/             # 게이트웨이, 프롬프트, 스키마, 조립(assemble)
  memory/               # 말투 프로필/샘플/어휘/페르소나
  spontaneous/          # 자동 발화 스케줄러/생성/조건
  jobs/                 # 유지보수/임포트/민감정보 정리
  safety/               # 필터, 레이트리밋
scripts/                # 어휘 분석, 백필, 진단 도구
deploy/                 # systemd 유닛, 배포 스크립트
test/                   # vitest
```

## 데이터 · 프라이버시

- 수집기는 `SELF_USER_ID`의 메시지만 저장합니다.
- 런타임 데이터는 `data/`(DB, `lexicon.json`, `persona*.md`)와 `/etc/openchat/openchat.env`에 두며, 모두 git에서 제외됩니다.
- `.env`, `auth.json`, `data/`, `secrets/`는 절대 커밋하지 마세요.

## 라이선스

Apache License 2.0. 전체 내용은 `LICENSE`, 저작자 표시는 `NOTICE`를 참고하세요.

- 저작권: Copyright 2026 openchat
- 요구사항: 저작권 고지와 `NOTICE`를 유지하고, **변경한 경우 변경 사실을 명시**해야 합니다(Apache-2.0 제4조).
- 서드파티: 한국어 형태소 분석기 **Kiwi(kiwipiepy)** 는 Apache-2.0(0.23.2 이하는 LGPL)이며, 학습 말뭉치(21세기 세종계획·모두의 말뭉치)는 재배포하지 않습니다. 자세한 표시는 `NOTICE`를 참고하세요.
