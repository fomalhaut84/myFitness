import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";

function formatPaceCsv(secPerKm: number | null): string {
  if (secPerKm === null) return "";
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function toCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.join(",");
  const dataLines = rows.map((row) =>
    row.map((cell) => {
      if (cell.includes(",") || cell.includes('"')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(",")
  );
  return [headerLine, ...dataLines].join("\n");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "activities";

    if (type === "activities") {
      const activities = await prisma.activity.findMany({
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
          formatDateLocal(a.startTime),
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
          "Content-Disposition": `attachment; filename="myfitness-activities-${formatDateLocal(new Date())}.csv"`,
        },
      });
    }

    if (type === "body") {
      const records = await prisma.bodyComposition.findMany({
        orderBy: { date: "desc" },
        select: { date: true, weight: true, bmi: true, bodyFat: true, muscleMass: true },
      });

      const csv = toCsv(
        ["날짜", "체중(kg)", "BMI", "체지방(%)", "근육량(kg)"],
        records.map((r) => [
          formatDateLocal(r.date),
          r.weight.toFixed(1),
          r.bmi?.toFixed(1) ?? "",
          r.bodyFat?.toFixed(1) ?? "",
          r.muscleMass?.toFixed(1) ?? "",
        ])
      );

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="myfitness-body-${formatDateLocal(new Date())}.csv"`,
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
