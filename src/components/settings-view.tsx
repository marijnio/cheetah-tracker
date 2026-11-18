"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  User,
  KeyRound,
  Download,
  Upload,
  AlertTriangle,
  Users,
  UserPlus,
  Trash2,
  Shield,
  LogOut,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react";
import type { PublicUser } from "@/lib/db/schema";

interface SettingsViewProps {
  currentUser: PublicUser;
  tradeCount: number;
  securityCount: number;
  onExportXml: () => void;
  onImportXmlFile: (file: File) => Promise<void>;
  onLoadSampleCsv: () => Promise<void>;
  onClearPortfolio: (confirmUsername: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function SettingsView({
  currentUser,
  tradeCount,
  securityCount,
  onExportXml,
  onImportXmlFile,
  onLoadSampleCsv,
  onClearPortfolio,
  onSignOut,
}: SettingsViewProps) {
  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isChangingPw, setIsChangingPw] = useState(false);

  // Import state
  const xmlInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Admin user management state
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [userMgmtMsg, setUserMgmtMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [resetTarget, setResetTarget] = useState<PublicUser | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");

  // Danger Zone Clear Portfolio state
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const fetchUsers = async () => {
    if (!currentUser.isAdmin) return;
    setLoadingUsers(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = (await res.json()) as { users: PublicUser[] };
        setUsers(data.users || []);
      }
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (currentUser.isAdmin) {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.isAdmin]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwStatus(null);
    if (newPassword !== confirmNewPassword) {
      setPwStatus({ type: "error", text: "New passwords do not match." });
      return;
    }
    setIsChangingPw(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setPwStatus({
          type: "error",
          text: data.error || "Failed to update password.",
        });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPwStatus({
        type: "success",
        text: "Password updated successfully.",
      });
    } catch {
      setPwStatus({ type: "error", text: "Network error." });
    } finally {
      setIsChangingPw(false);
    }
  };

  const handleXmlFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const confirmed = window.confirm(
      `Import "${file.name}"?\n\nThis will REPLACE your current portfolio (${tradeCount} trades, ${securityCount} securities, cash balance, and risk settings) with the contents of this XML file.`
    );
    if (!confirmed) {
      if (xmlInputRef.current) xmlInputRef.current.value = "";
      return;
    }

    setIsImporting(true);
    try {
      await onImportXmlFile(file);
    } finally {
      setIsImporting(false);
      if (xmlInputRef.current) xmlInputRef.current.value = "";
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserMgmtMsg(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newUserPassword,
          isAdmin: newUserIsAdmin,
        }),
      });
      const data = (await res.json()) as { user?: PublicUser; error?: string };
      if (!res.ok) {
        setUserMgmtMsg({
          type: "error",
          text: data.error || "Could not create user.",
        });
        return;
      }
      setNewUsername("");
      setNewUserPassword("");
      setNewUserIsAdmin(false);
      setUserMgmtMsg({
        type: "success",
        text: `Created account for "${data.user?.username}".`,
      });
      fetchUsers();
    } catch {
      setUserMgmtMsg({ type: "error", text: "Network error." });
    }
  };

  const handleResetUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setUserMgmtMsg(null);
    try {
      const res = await fetch(`/api/users/${resetTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: resetPasswordValue }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setUserMgmtMsg({
          type: "error",
          text: data.error || "Could not reset password.",
        });
        return;
      }
      setUserMgmtMsg({
        type: "success",
        text: `Password reset for "${resetTarget.username}".`,
      });
      setResetTarget(null);
      setResetPasswordValue("");
    } catch {
      setUserMgmtMsg({ type: "error", text: "Network error." });
    }
  };

  const handleDeleteUser = async (target: PublicUser) => {
    if (
      !window.confirm(
        `Delete user "${target.username}" and all ${target.tradeCount ?? 0} of their trades? This cannot be undone.`
      )
    ) {
      return;
    }
    setUserMgmtMsg(null);
    const res = await fetch(`/api/users/${target.id}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setUserMgmtMsg({
        type: "error",
        text: data.error || "Could not delete user.",
      });
      return;
    }
    setUserMgmtMsg({
      type: "success",
      text: `Deleted user "${target.username}".`,
    });
    fetchUsers();
  };

  const handleConfirmClear = async (e: React.FormEvent) => {
    e.preventDefault();
    setClearError(null);
    setIsClearing(true);
    try {
      await onClearPortfolio(clearConfirmText);
      setIsClearModalOpen(false);
      setClearConfirmText("");
    } catch (err) {
      setClearError(
        err instanceof Error ? err.message : "Failed to clear portfolio."
      );
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Hidden XML input */}
      <input
        ref={xmlInputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        onChange={handleXmlFileSelected}
        className="hidden"
      />

      {/* 1. Account & Security */}
      <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <User className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">
              Account &amp; Security
            </h2>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center text-sm font-bold uppercase">
              {currentUser.username.slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {currentUser.username}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    currentUser.isAdmin
                      ? "bg-blue-100 text-blue-700"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {currentUser.isAdmin ? "Admin" : "Member"}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Private workspace: {tradeCount} trades &middot; {securityCount}{" "}
                securities
              </p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <KeyRound className="w-3.5 h-3.5 text-slate-400" />
              <span>Change Password</span>
            </div>

            {pwStatus && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  pwStatus.type === "success"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}
              >
                {pwStatus.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{pwStatus.text}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="password"
                required
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white"
              />
              <input
                type="password"
                required
                minLength={6}
                placeholder="New password (min 6 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white"
              />
              <input
                type="password"
                required
                minLength={6}
                placeholder="Confirm new password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={isChangingPw}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {isChangingPw ? "Updating..." : "Update Password"}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* 2. Portfolio Data (Export & Import) */}
      <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2.5">
          <FileSpreadsheet className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-bold text-slate-900">
            Portfolio Data (Backup &amp; Restore)
          </h2>
        </div>

        <div className="divide-y divide-slate-100">
          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xs font-bold text-slate-900">
                Export Portfolio (XML)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Download a complete XML backup of your trades, securities,
                forex pairs, cash balance, and risk settings.
              </p>
            </div>
            <button
              type="button"
              onClick={onExportXml}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export XML</span>
            </button>
          </div>

          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xs font-bold text-slate-900">
                Import Portfolio (XML)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Restore from a Cheetah XML file.{" "}
                <span className="font-semibold text-amber-700">
                  Replaces your current portfolio data.
                </span>
              </p>
            </div>
            <button
              type="button"
              disabled={isImporting}
              onClick={() => xmlInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-semibold transition-colors shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{isImporting ? "Importing..." : "Import & Replace..."}</span>
            </button>
          </div>

          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xs font-bold text-slate-900">
                Load Sample Portfolio
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Populate your account with sample trades to explore charts and
                metrics. Replaces your current trades.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (
                  tradeCount === 0 ||
                  window.confirm(
                    `Replace your ${tradeCount} existing trades with the sample portfolio?`
                  )
                ) {
                  onLoadSampleCsv();
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors shrink-0 cursor-pointer"
            >
              <span>Load Sample Trades</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. User Management (Admin Only) */}
      {currentUser.isAdmin && (
        <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2.5">
            <Users className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">
              User Management
            </h2>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
              Admin
            </span>
          </div>

          <div className="p-6 space-y-6">
            {userMgmtMsg && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  userMgmtMsg.type === "success"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}
              >
                {userMgmtMsg.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{userMgmtMsg.text}</span>
              </div>
            )}

            {/* Create User Form */}
            <form
              onSubmit={handleCreateUser}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 space-y-3"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <UserPlus className="w-3.5 h-3.5 text-slate-500" />
                <span>Create Account for a Friend</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Username (e.g. alex)"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Temporary password (min 6)"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newUserIsAdmin}
                      onChange={(e) => setNewUserIsAdmin(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Admin</span>
                  </label>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Create User
                  </button>
                </div>
              </div>
            </form>

            {/* Users Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5">Username</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">Trades</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingUsers ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-4 text-center text-slate-400"
                      >
                        Loading users...
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => {
                      const isSelf = u.id === currentUser.id;
                      return (
                        <tr key={u.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {u.username}{" "}
                            {isSelf && (
                              <span className="text-[10px] text-slate-400 font-normal">
                                (you)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                u.isAdmin
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {u.isAdmin && <Shield className="w-2.5 h-2.5" />}
                              {u.isAdmin ? "Admin" : "Member"}
                            </span>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-slate-600">
                            {u.tradeCount ?? 0}
                          </td>
                          <td className="px-4 py-3 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setResetTarget(u);
                                setResetPasswordValue("");
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition-colors cursor-pointer"
                            >
                              Reset Password
                            </button>
                            {!isSelf && (
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u)}
                                className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer inline-flex items-center align-middle"
                                title="Delete user"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {resetTarget && (
              <form
                onSubmit={handleResetUserPassword}
                className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center gap-3"
              >
                <span className="text-xs font-semibold text-amber-900">
                  Set new password for {resetTarget.username}:
                </span>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="New password (min 6 chars)"
                  value={resetPasswordValue}
                  onChange={(e) => setResetPasswordValue(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetTarget(null)}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      )}

      {/* 4. Danger Zone (GitHub-style protected destructive actions) */}
      <section className="bg-white rounded-2xl border-2 border-rose-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 bg-rose-50/70 border-b border-rose-200 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
          <h2 className="text-sm font-bold text-rose-900">Danger Zone</h2>
        </div>

        <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-xs font-bold text-slate-900">
              Clear Portfolio Data
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Permanently delete all {tradeCount} trades and {securityCount}{" "}
              securities from your account, and reset cash balance to €25,000.
              Other users&apos; portfolios are not affected.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setClearConfirmText("");
              setClearError(null);
              setIsClearModalOpen(true);
            }}
            className="px-4 py-2 rounded-xl bg-white hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-300 hover:border-rose-600 text-xs font-bold transition-colors shrink-0 cursor-pointer"
          >
            Clear Portfolio...
          </button>
        </div>
      </section>

      {/* Type-to-confirm Danger Zone Modal */}
      {isClearModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold">
                Are you absolutely sure?
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              This action cannot be undone. It will permanently delete all{" "}
              <span className="font-bold text-slate-900">{tradeCount} trades</span>{" "}
              and{" "}
              <span className="font-bold text-slate-900">
                {securityCount} securities
              </span>{" "}
              from <span className="font-bold">{currentUser.username}</span>
              &apos;s portfolio. Export an XML backup first if you want to keep a
              copy.
            </p>

            {clearError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {clearError}
              </div>
            )}

            <form onSubmit={handleConfirmClear} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Please type{" "}
                  <span className="font-mono font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                    {currentUser.username}
                  </span>{" "}
                  to confirm.
                </label>
                <input
                  type="text"
                  required
                  value={clearConfirmText}
                  onChange={(e) => setClearConfirmText(e.target.value)}
                  placeholder={currentUser.username}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsClearModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isClearing ||
                    clearConfirmText.trim().toLowerCase() !==
                      currentUser.username.toLowerCase()
                  }
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                >
                  {isClearing
                    ? "Clearing..."
                    : "I understand, clear my portfolio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
