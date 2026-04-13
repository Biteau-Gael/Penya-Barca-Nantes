import { useLoaderData, Link, useSearchParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { rankingsLoader } from "./rankings.server";

export const loader = rankingsLoader;

export function meta() {
  return [{ title: "Classement — Penya Blaugrana Nantes" }];
}

interface RankingItem {
  position: number;
  pseudo: string;
  avatarUrl: string | null;
  totalPoints: number;
  totalPredictions: number;
  exactScores: number;
  currentStreak: number;
  bestStreak: number;
}

interface SeasonInfo {
  label: string;
  isActive: boolean;
}

export default function Rankings() {
  const { rankings, currentSeason, activeSeason, seasons } = useLoaderData<{
    rankings: RankingItem[];
    currentSeason: string;
    activeSeason: string;
    seasons: SeasonInfo[];
  }>();

  const isViewingActive = currentSeason === activeSeason;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Classement des pronostiqueurs</h1>

        {/* Sélecteur de saison */}
        {seasons.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {seasons.map((s) => (
              <Link
                key={s.label}
                to={s.isActive ? "/classement" : `/classement?saison=${s.label}`}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  currentSeason === s.label
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </Link>
            ))}
          </div>
        )}

        {!isViewingActive && (
          <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground text-center">
            Archive de la saison {currentSeason}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {isViewingActive ? "Classement" : `Classement ${currentSeason}`} ({rankings.length} joueurs)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rankings.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <p className="text-muted-foreground">
                  {isViewingActive
                    ? "Les premiers points arrivent bientôt !"
                    : "Aucun pronostic pour cette saison."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {rankings.map((r) => (
                  <div
                    key={r.position}
                    className={`flex items-center gap-3 rounded-md border p-3 ${
                      r.position <= 3 ? "border-accent/50 bg-accent/5" : ""
                    }`}
                  >
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full font-bold text-sm ${
                      r.position === 1
                        ? "bg-accent text-foreground"
                        : r.position === 2
                          ? "bg-muted text-foreground"
                          : r.position === 3
                            ? "bg-primary/20 text-primary"
                            : "bg-muted/50 text-muted-foreground"
                    }`}>
                      {r.position}
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-white font-bold overflow-hidden shrink-0">
                      {r.avatarUrl ? (
                        <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        r.pseudo.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{r.pseudo}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.totalPredictions} pronos · {r.exactScores} exacts
                        {isViewingActive && r.currentStreak > 0 && (
                          <span className="text-orange-400 ml-1">· {r.currentStreak} en série</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-primary">{r.totalPoints}</p>
                      <p className="text-xs text-muted-foreground">pts</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
