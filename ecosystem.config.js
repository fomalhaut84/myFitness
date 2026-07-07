module.exports = {
  apps: [
    {
      name: 'myfitness',
      script: 'node_modules/.bin/next',
      args: 'start -p 4200',
      cwd: '/home/nasty68/myFitness',
      env: {
        NODE_ENV: 'production',
        PORT: 4200,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '1024M',
      node_args: '--max-old-space-size=1024',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'myfitness-bot',
      script: 'dist/bot/standalone.cjs',
      cwd: '/home/nasty68/myFitness',
      env: {
        NODE_ENV: 'production',
        // #180: 봇 프로세스 (claude-advisor) 가 pm2 delete + start 로 시작되면
        // shell env override 를 자동 상속 못 함. 명시적으로 pass.
        // - MCP_PORT / MCP_HTTP_URL: mcp 앱과 같은 env 공유해 client/server 포트 정합 유지.
        // - MCP_TRANSPORT: stdio 회귀 스위치. bot env 에 명시 안 하면 rollback 절차
        //   (MCP_TRANSPORT=stdio pm2 delete+start) 가 봇에 도달 못 해 롤백 조용히 실패.
        MCP_PORT: process.env.MCP_PORT || '',
        MCP_HTTP_URL: process.env.MCP_HTTP_URL || '',
        MCP_TRANSPORT: process.env.MCP_TRANSPORT || '',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=512',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // SIGTERM → bot.stop() 의 long-poll abort 완료까지 시간 확보 (기본 1.6s → 15s).
      // 부족 시 SIGKILL 강제 → 텔레그램 측 polling 세션 잔존 → 다음 spawn 409.
      kill_timeout: 15000,
      // 정상 동작 안정성 기준 — 30초 이상 살아있어야 안정으로 간주.
      min_uptime: 30000,
      // 지수 백오프 무한 재시도 (100ms → 200ms → 400ms ... 최대 15s 사이클).
      // max_restarts 의 영구 stop 위험 회피 — 봇이 알림 채널 단일 장애점이라
      // transient 외부 장애(텔레그램/네트워크 일시 outage) 회복까지 무한 대기.
      // 진짜 코드 버그 시에도 간격이 점차 늘어 로그 폭증/리소스 낭비 차단.
      exp_backoff_restart_delay: 100,
      // PM2 default max_restarts=16 명시적 override — exp_backoff 만으로는 30s min_uptime 도달 못한
      // 16회 실패 시 errored stop. Number.MAX_SAFE_INTEGER 로 실질 무한 보장.
      max_restarts: Number.MAX_SAFE_INTEGER,
    },
    {
      // #180 — MCP 서버를 별도 PM2 앱으로 승격.
      // stdio subprocess (매 세션 spawn/kill) → 상시 상주 HTTP 서버.
      // 목적: 로그 트래킹 개선 (pm2 logs 로 사후 추적), cold-start 제거, Prisma 커넥션 재사용.
      // Multi-session 패턴은 src/mcp/server.ts startHttp() 참고.
      // 포트: 4200 (웹) 회피 → 4301. 웹은 그대로 4200 유지.
      name: 'myfitness-mcp',
      script: 'dist/mcp/server.cjs',
      cwd: '/home/nasty68/myFitness',
      env: {
        NODE_ENV: 'production',
        MCP_TRANSPORT: 'http',
        // #180 Codex bot P2: shell env override (MCP_PORT=4302 ./deploy.sh) 존중.
        // PM2 는 ecosystem env 를 shell 뒤에 덮어씌우므로 여기서 process.env.MCP_PORT
        // fallback 을 명시하지 않으면 deploy.sh 의 health check 포트와 어긋난다.
        MCP_PORT: process.env.MCP_PORT || '4301',
      },
      instances: 1,
      autorestart: true,
      // SIGTERM → server.ts shutdown() graceful close (15s 강제 종료)
      kill_timeout: 15000,
      min_uptime: 30000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=512',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
