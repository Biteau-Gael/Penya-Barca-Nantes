import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { adminMembersLoader, adminMembersAction } from "./admin.members.server";

export const loader = adminMembersLoader;
export const action = adminMembersAction;

export function meta() {
  return [{ title: "Gestion des membres — Admin Penya" }];
}

interface MemberData {
  id: string;
  name: string;
  pseudo: string | null;
  email: string;
  role: string;
  avatarUrl: string | null;
  createdAt: string;
}

interface ActionResult { success?: boolean; message?: string; error?: string }

export default function AdminMembers() {
  const { members } = useLoaderData<{ members: MemberData[] }>();
  const actionData = useActionData<ActionResult>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Gestion des membres ({members.length})</h1>

        {actionData?.success && (
          <div className="rounded-md bg-success/10 p-3 text-sm text-success">{actionData.message}</div>
        )}
        {actionData?.error && (
          <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{actionData.error}</div>
        )}

        <Card>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {members.map((member) => {
                const displayName = member.pseudo || member.name;
                const date = new Date(member.createdAt).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                });

                return (
                  <div key={member.id} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-white font-bold overflow-hidden shrink-0">
                        {member.avatarUrl ? (
                          <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          displayName.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{displayName}</p>
                        <p className="text-xs text-muted-foreground">{member.email} — {date}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Form method="post">
                        <input type="hidden" name="intent" value="change-role" />
                        <input type="hidden" name="memberId" value={member.id} />
                        <select
                          name="role"
                          defaultValue={member.role}
                          onChange={(e) => e.target.form?.requestSubmit()}
                          className="text-xs border border-input rounded px-2 py-1 bg-transparent"
                          disabled={isSubmitting}
                        >
                          <option value="member">Membre</option>
                          <option value="admin">Admin</option>
                          <option value="partner">Partenaire</option>
                        </select>
                      </Form>
                      {deleteConfirmId === member.id ? (
                        <Form method="post" className="flex gap-1">
                          <input type="hidden" name="intent" value="delete-member" />
                          <input type="hidden" name="memberId" value={member.id} />
                          <Button type="submit" variant="destructive" size="sm" disabled={isSubmitting}>Oui</Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>Non</Button>
                        </Form>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive text-xs"
                          onClick={() => setDeleteConfirmId(member.id)}
                        >
                          Supprimer
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
