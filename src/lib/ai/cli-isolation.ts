// #563: Claude CLI 를 부르는 모든 곳에 붙이는 격리 인자.
// 서버 CLI 는 로그인 계정에 연결된 claude.ai 커넥터 (예: Claude Docs) 를 MCP 도구로 자동 로드한다. `--tools ""` 는 내장 도구만 끄므로
// 커넥터가 남고, 모델이 그것을 부르면 1회성 호출 (`--max-turns 1`) 은 error_max_turns 로 실패 · 어드바이저는 권한 거부로 턴을 낭비한다.
// `--strict-mcp-config` = `--mcp-config` 로 넘긴 서버만 사용 (넘기지 않으면 MCP 없음).
export const CLAUDE_CLI_ISOLATION_ARGS = ["--strict-mcp-config"] as const;
