import { useLoaderData, Link } from "react-router";
import { Card, CardContent } from "~/components/ui/card";
import { calendarLoader, type FormResult } from "./calendar.server";

export const loader = calendarLoader;

export function meta() {
  return [
    { title: "Calendrier des matchs — Penya Blaugrana Nantes" },
    {
      name: "description",
      content: "Consultez les prochains matchs du FC Barcelone suivis par la Penya Blaugrana Nantes.",
    },
  ];
}

interface MatchItem {
  id: string;
  opponent: string;
  competition: string;
  matchDate: string;
  venue: string;
  homeScore: number | null;
  awayScore: number | null;
  opponentLogo: string | null;
  competitionLogo: string | null;
}

const BARCA_LOGO = "https://images.fotmob.com/image_resources/logo/teamlogo/8634.png";

function isMatchToday(matchDate: string): boolean {
  const today = new Date();
  const match = new Date(matchDate);
  return match.toDateString() === today.toDateString();
}

function MatchCard({ match, isPast }: { match: MatchItem; isPast: boolean }) {
  const date = new Date(match.matchDate).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const homeTeam = match.venue === "home" ? "Barça" : match.opponent;
  const awayTeam = match.venue === "home" ? match.opponent : "Barça";
  const homeLogo = match.venue === "home" ? BARCA_LOGO : match.opponentLogo;
  const awayLogo = match.venue === "home" ? match.opponentLogo : BARCA_LOGO;
  const today = isMatchToday(match.matchDate);

  return (
    <div className="space-y-1">
      <Link to={`/matchs/${match.id}`}>
        <Card className={`hover:border-primary/50 transition-colors ${isPast ? "opacity-60" : ""} ${today ? "border-green-500/50" : ""}`}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {homeLogo && (
                  <img src={homeLogo} alt={homeTeam} className="h-8 w-8 object-contain shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">
                    {homeTeam} vs {awayTeam}
                    {match.homeScore !== null && (
                      <span className="ml-2 text-primary font-bold">
                        ({match.homeScore} - {match.awayScore})
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {match.competitionLogo && (
                      <img src={match.competitionLogo} alt={match.competition} className="h-4 w-4 object-contain" />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {match.competition} — {match.venue === "home" ? "Domicile" : "Extérieur"}
                    </p>
                  </div>
                </div>
                {awayLogo && (
                  <img src={awayLogo} alt={awayTeam} className="h-8 w-8 object-contain shrink-0" />
                )}
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="text-sm font-medium text-secondary">{date}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
      {today && (
        <Link
          to={`/soiree/${match.id}`}
          className="flex items-center justify-center gap-2 rounded-lg border border-green-500/30 bg-green-500/5 p-2 text-xs font-bold text-green-400 hover:bg-green-500/10 transition-colors"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          Soirée match en direct →
        </Link>
      )}
    </div>
  );
}

function FormBadge({ result }: { result: FormResult }) {
  const config = {
    V: { label: "V", className: "bg-green-500 text-white" },
    N: { label: "N", className: "bg-yellow-500 text-white" },
    D: { label: "D", className: "bg-red-500 text-white" },
  };
  const { label, className } = config[result];
  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${className}`}>
      {label}
    </span>
  );
}

export default function Calendar() {
  const { upcoming, past, recentForm } = useLoaderData<{ upcoming: MatchItem[]; past: MatchItem[]; recentForm: FormResult[] }>();

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-8">
        <h1 className="text-2xl font-bold text-foreground">Calendrier des matchs</h1>

        {/* Forme récente */}
        {recentForm.length > 0 && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img
                    src={BARCA_LOGO}
                    alt="Barça"
                    className="h-6 w-6 object-contain"
                  />
                  <span className="text-sm font-medium text-foreground">Forme récente</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {recentForm.map((r, i) => (
                    <FormBadge key={i} result={r} />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* À venir */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            À venir ({upcoming.length})
          </h2>
          {upcoming.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              Aucun match programmé pour le moment.
            </p>
          ) : (
            <div className="space-y-3">
              {upcoming.map((match) => (
                <MatchCard key={match.id} match={match} isPast={false} />
              ))}
            </div>
          )}
        </section>

        {/* Passés */}
        {past.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-muted-foreground mb-4">
              Matchs passés ({past.length})
            </h2>
            <div className="space-y-3">
              {past.map((match) => (
                <MatchCard key={match.id} match={match} isPast={true} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
