import { NextResponse } from "next/server";
import { APP_VERSION, APP_NAME } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    name: APP_NAME,
    version: APP_VERSION,
    environment: process.env.NODE_ENV || "development",
  });
}

