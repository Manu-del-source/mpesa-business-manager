"use client";

import React, { useEffect, useState, useCallback } from "react";
import { fetchTenantMembers, inviteTenantMember, type MemberItem } from "@/lib/api/tenant";
import { ApiClientError } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { OmniPageHeader } from "@/components/shared/omni-page-header";
import { OmniErrorBanner } from "@/components/shared/omni-empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Role = MemberItem["role"];

const ROLE_COLORS: Record<Role, "destructive" | "warning" | "info" | "success" | "muted"> = {
  OWNER: "destructive",
  ADMIN: "warning",
  DEVELOPER: "info",
  FINANCE: "success",
  VIEWER: "muted",
};

export function OmniTeamView({ canManage, currentUserRole }: { canManage: boolean; currentUserRole: Role }) {
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("VIEWER");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchTenantMembers();
      setMembers(res.data);
      setAvailableRoles(res.meta.availableRoles);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load team members.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openInvite() {
    setEmail("");
    setRole("VIEWER");
    setInviteError(null);
    setInviteOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setInviteError("Email is required.");
      return;
    }
    setSubmitting(true);
    setInviteError(null);
    try {
      const created = await inviteTenantMember({ email, role });
      setMembers((prev) => [...prev, created]);
      setInviteOpen(false);
    } catch (err) {
      setInviteError(err instanceof ApiClientError ? err.message : "Failed to invite member.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader title="Team & RBAC" description="Manage who has access to this tenant and what they can do.">
        {canManage && (
          <button
            onClick={openInvite}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            <span>Invite Member</span>
          </button>
        )}
      </OmniPageHeader>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 text-body-sm text-on-surface-variant">
        Your role: <Badge variant={ROLE_COLORS[currentUserRole]}>{currentUserRole}</Badge>
        <span className="ml-2">
          Frontend role checks are UX only — every action is re-verified against your permissions on the server.
        </span>
      </div>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
              <tr>
                <th className="p-3 px-4">Member</th>
                <th className="p-3 px-4">Role</th>
                <th className="p-3 px-4">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td className="p-4" colSpan={3}><Skeleton className="h-5 w-full" /></td></tr>
                ))
              ) : (
                members.map((m) => (
                  <tr key={m.id}>
                    <td className="p-3 px-4 text-primary font-medium">{m.email}</td>
                    <td className="p-3 px-4"><Badge variant={ROLE_COLORS[m.role]}>{m.role}</Badge></td>
                    <td className="p-3 px-4 text-on-surface-variant">{formatDate(m.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">Invite Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {inviteError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{inviteError}</p>
              )}
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(availableRoles.length ? availableRoles : ["OWNER", "ADMIN", "DEVELOPER", "FINANCE", "VIEWER"]).map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
              >
                {submitting ? "Inviting…" : "Send Invite"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
