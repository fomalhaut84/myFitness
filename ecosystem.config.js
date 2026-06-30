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
      // 봇 polling 영구 에러(예: 401 토큰 만료) 시 PM2 restart 무한 loop 방지.
      // min_uptime 안에 max_restarts 초과 시 PM2가 process를 errored 상태로 stop.
      min_uptime: '60s',
      max_restarts: 10,
    },
  ],
}
