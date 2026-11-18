import React from "react";
import { redirect } from "next/navigation";
import { getUserCount } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  const initialized = getUserCount() > 0;
  return <LoginForm initialized={initialized} />;
}
