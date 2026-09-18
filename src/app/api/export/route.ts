import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import { parseYmdRangeParams } from "@/lib/history/range-params";

function formatPaceCsv(secPerKm: number | null): string {
  if (secPerKm === null) return "";
  const totalSec = Math.round(secPerKm);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** CSV injection 방지: =, +, -, @ 로 시작하는 셀에 ' 접두 */
function sanitizeCell(cell: string): string {
  if (/^[=+\-@]/.test(cell)) {
    return `'${cell}`;
  }
  return cell;
}

function toCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.join(",");
  const dataLines = rows.map((row) =>
    row.map((cell) => {
      const safe = sanitizeCell(cell);
      if (safe.includes(",") || safe.includes('"') || safe.includes("'")) {
        return `"${safe.replace(/"/g, '""')}"`;
      }
      return safe;
    }).join(",")
  );
  return [headerLine, ...dataLines].join("\n");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "activities";
    // #393 (M15-1): from/to = KST 달력일 inclusive. 없으면 전체 (기존 동작).
    const range = parseYmdRangeParams(url.searchParams.get("from"), url.searchParams.get("to"));
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }
    const rangeSuffix = range.from || range.to ? `-${range.from ?? "start"}_${range.to ?? "end"}` : "";

    if (type === "activities") {
      const activities = await prisma.activity.findMany({
        where: range.where ? { startTime: range.where } : {},
        orderBy: { startTime: "desc" },
        select: {
          name: true,
          activityType: true,
          startTime: true,
          duration: true,
          distance: true,
          avgPace: true,
          avgHR: true,
          maxHR: true,
          calories: true,
          elevationGain: true,
          trainingEffect: true,
          vo2maxEstimate: true,
        },
      });

      const csv = toCsv(
        ["날짜", "이름", "타입", "거리(km)", "시간(분)", "페이스(/km)", "평균HR", "최대HR", "칼로리", "고도(m)", "TE", "VO2max"],
        activities.map((a) => [
          ymdKST(a.startTime),
          a.name,
          a.activityType,
          a.distance ? (a.distance / 1000).toFixed(2) : "",
          String(Math.round(a.duration / 60)),
          formatPaceCsv(a.avgPace),
          a.avgHR?.toString() ?? "",
          a.maxHR?.toString() ?? "",
          a.calories?.toString() ?? "",
          a.elevationGain ? Math.round(a.elevationGain).toString() : "",
          a.trainingEffect?.toFixed(1) ?? "",
          a.vo2maxEstimate?.toFixed(1) ?? "",
        ])
      );

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="myfitness-activities${rangeSuffix}-${ymdKST()}.csv"`,
        },
      });
    }

    if (type === "body") {
      const records = await prisma.bodyComposition.findMany({
        where: range.where ? { date: range.where } : {},
        orderBy: { date: "desc" },
        select: { date: true, weight: true, bmi: true, bodyFat: true, muscleMass: true },
      });

      const csv = toCsv(
        ["날짜", "체중(kg)", "BMI", "체지방(%)", "근육량(kg)"],
        records.map((r) => [
          ymdKST(r.date),
          r.weight.toFixed(1),
          r.bmi?.toFixed(1) ?? "",
          r.bodyFat?.toFixed(1) ?? "",
          r.muscleMass?.toFixed(1) ?? "",
        ])
      );

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="myfitness-body${rangeSuffix}-${ymdKST()}.csv"`,
        },
      });
    }

    return NextResponse.json(
      { error: "type 파라미터: activities 또는 body" },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
