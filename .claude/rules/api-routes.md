# API Routes 규칙

이 규칙은 API route handler 파일에 적용.

- 모든 route handler는 try-catch로 감싸고, 에러 시 `{ error: string }` 형태로 응답
- DB 접근은 반드시 singleton client 사용
- 날짜는 ISO 8601 형식으로 반환
- 수치 데이터 응답에 항상 단위 포함 (km, kg, bpm, kcal 등)
