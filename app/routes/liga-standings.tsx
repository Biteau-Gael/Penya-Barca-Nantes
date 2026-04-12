import { useLoaderData } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ligaStandingsLoader, type StandingEntry } from "./liga-standings.server";

export const loader = ligaStandingsLoader;

export default function LigaStandings() {
  const { standings, error } = useLoaderData<{ standings: StandingEntry[]; error: string | null }>();

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <img
            src="https://images.fotmob.com/image_resources/logo/leaguelogo/dark/87.png"
            alt="LaLiga"
            className="h-8 w-8 object-contain"
          />
          <h1 className="text-2xl font-bold text-foreground">Classement Liga</h1>
        </div>

        {error ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              {/* En-tête tableau */}
              <div className="grid grid-cols-[2rem_1fr_2rem_2rem_2rem_2rem_2.5rem_2.5rem] gap-1 px-3 py-2 border-b border-border text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                <span>#</span>
                <span>Équipe</span>
                <span className="text-center">MJ</span>
                <span className="text-center">V</span>
                <span className="text-center">N</span>
                <span className="text-center">D</span>
                <span className="text-center">Diff</span>
                <span className="text-center">Pts</span>
              </div>

              {/* Lignes */}
              {standings.map((team) => (
                <div
                  key={team.teamId}
                  className={`grid grid-cols-[2rem_1fr_2rem_2rem_2rem_2rem_2.5rem_2.5rem] gap-1 px-3 py-2 border-b last:border-0 border-border items-center text-sm transition-colors ${
                    team.isBarca
                      ? "bg-primary/10 font-bold"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {team.qualColor && (
                      <span
                        className="inline-block h-3 w-1 rounded-full"
                        style={{ backgroundColor: team.qualColor }}
                      />
                    )}
                    <span className="text-muted-foreground text-xs">{team.position}</span>
                  </span>
                  <div className="flex items-center gap-2 min-w-0">
                    <img src={team.logo} alt={team.name} className="h-5 w-5 object-contain shrink-0" />
                    <span className={`truncate ${team.isBarca ? "text-primary" : "text-foreground"}`}>
                      {team.name}
                    </span>
                  </div>
                  <span className="text-center text-muted-foreground">{team.played}</span>
                  <span className="text-center text-green-400">{team.wins}</span>
                  <span className="text-center text-yellow-400">{team.draws}</span>
                  <span className="text-center text-red-400">{team.losses}</span>
                  <span className={`text-center font-medium ${
                    team.goalDiff > 0 ? "text-green-400" : team.goalDiff < 0 ? "text-red-400" : "text-muted-foreground"
                  }`}>
                    {team.goalDiff > 0 ? "+" : ""}{team.goalDiff}
                  </span>
                  <span className={`text-center font-bold ${team.isBarca ? "text-primary" : "text-foreground"}`}>
                    {team.points}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
