import { useLoaderData } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { badgesLoader } from "./badges.server";

export const loader = badgesLoader;

export function meta() {
  return [{ title: "Badges — Penya Blaugrana Nantes" }];
}

interface BadgeItem {
  key: string;
  name: string;
  description: string;
  emoji: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

export default function Badges() {
  const { badges, unlockedCount, totalCount } = useLoaderData<{
    badges: BadgeItem[];
    unlockedCount: number;
    totalCount: number;
  }>();

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Badges</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {unlockedCount} / {totalCount} débloqués
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {badges.map((badge) => (
            <Card
              key={badge.key}
              className={`transition-all ${
                badge.unlocked
                  ? "border-accent/50 bg-accent/5"
                  : "opacity-40 grayscale"
              }`}
            >
              <CardContent className="pt-5 pb-4 text-center space-y-2">
                <span className="text-3xl">{badge.emoji}</span>
                <p className="font-semibold text-sm text-foreground">{badge.name}</p>
                <p className="text-xs text-muted-foreground">{badge.description}</p>
                {badge.unlockedAt && (
                  <p className="text-[10px] text-accent">
                    {new Date(badge.unlockedAt).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
