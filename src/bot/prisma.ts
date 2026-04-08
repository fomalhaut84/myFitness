import { PrismaClient } from "@prisma/client";

// CJS 빌드에서 @prisma/client를 external로 처리하되,
// 서버에서 npx prisma generate 실행 후 사용
const prisma = new PrismaClient();

export default prisma;
