import { useLoaderData, Link } from "react-router";
import { Card, CardContent } from "~/components/ui/card";
import { membersListLoader } from "./members-list.server";

export const loader = membersListLoader;

interface MemberItem {
  id: string;
  name: string;
  pseudo: string | null;
  avatarUrl: string | null;
  role: string;
  createdAt: string;
}

export default function MembersList() {
  const { members } = useLoaderData<{ members: MemberItem[] }>();

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-6">
          Les membres de la Penya
        </h1>

        {members.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            Aucun membre pour le moment.
          </p>
        ) : (
          <div className="space-y-3">
            {members.map((member) => {
              const displayName = member.pseudo || member.name;
              const createdAt = new Date(member.createdAt).toLocaleDateString("fr-FR", {
                month: "long",
                year: "numeric",
              });

              return (
                <Link key={member.id} to={`/membres/${member.id}`}>
                  <Card className="hover:border-primary/50 transition-colors">
                    <CardContent className="flex items-center gap-4 py-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-white text-lg font-bold overflow-hidden shrink-0">
                        {member.avatarUrl ? (
                          <img
                            src={member.avatarUrl}
                            alt={`Avatar de ${displayName}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          displayName.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {displayName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Membre depuis {createdAt}
                        </p>
                      </div>
                      {member.role === "admin" && (
                        <span className="ml-auto text-xs bg-primary/10 text-primary px-2 py-1 rounded-full shrink-0">
                          Admin
                        </span>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
