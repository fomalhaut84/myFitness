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
  ],
}
