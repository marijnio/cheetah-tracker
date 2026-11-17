import { NextResponse } from "next/server";
import {
  APP_VERSION,
  APP_NAME,
  GIT_COMMIT,
  BUILD_TIME,
  APP_BUILD_LABEL,
} from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    name: APP_NAME,
    version: APP_VERSION,
    commit: GIT_COMMIT,
    buildTime: BUILD_TIME,
    buildLabel: APP_BUILD_LABEL,
    environment: process.env.NODE_ENV || "development",
  });
}

