import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const statuses = await prisma.syncMetadata.findMany({
      orderBy: { dataType: "asc" },
    });

    return NextResponse.json({ data: statuses });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
