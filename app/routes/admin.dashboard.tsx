import { useLoaderData, Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { adminDashboardLoader } from "./admin.dashboard.server";

export const loader = adminDashboardLoader;

export function meta() {
  return [{ title: "Tableau de bord — Admin Penya" }];
}

interface Stats {
  totalMembers: number;
  recentMembers: number;
  totalMatches: number;
  totalPredictions: number;
  totalPosts: number;
  recentPosts: number;
  totalComments: number;
  totalReactions: number;
}

export default function AdminDashboard() {
  const { stats } = useLoaderData<{ stats: Stats }>();

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Tableau de bord</h1>
          <nav className="flex gap-2">
            <Link to="/admin/matchs" className="text-sm text-primary hover:underline">Matchs</Link>
            <Link to="/admin/membres" className="text-sm text-primary hover:underline">Membres</Link>
            <Link to="/admin/evenements" className="text-sm text-primary hover:underline">Événements</Link>
          </nav>
        </div>

        {/* KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold text-primary">{stats.totalMembers}</p>
              <p className="text-xs text-muted-foreground mt-1">Membres</p>
              {stats.recentMembers > 0 && (
                <p className="text-xs text-success mt-1">+{stats.recentMembers} cette semaine</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold text-secondary">{stats.totalPredictions}</p>
              <p className="text-xs text-muted-foreground mt-1">Pronostics soumis</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold text-accent">{stats.totalPosts}</p>
              <p className="text-xs text-muted-foreground mt-1">Posts publiés</p>
              {stats.recentPosts > 0 && (
                <p className="text-xs text-success mt-1">+{stats.recentPosts} cette semaine</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-3xl font-bold text-foreground">{stats.totalMatches}</p>
              <p className="text-xs text-muted-foreground mt-1">Matchs programmés</p>
            </CardContent>
          </Card>
        </div>

        {/* Activité communautaire */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Activité communautaire</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3 text-center">
              <div>
                <p className="text-xl font-bold text-foreground">{stats.totalReactions}</p>
                <p className="text-xs text-muted-foreground">Réactions</p>
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{stats.totalComments}</p>
                <p className="text-xs text-muted-foreground">Commentaires</p>
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">
                  {stats.totalMembers > 0
                    ? Math.round((stats.totalPredictions / Math.max(stats.totalMatches, 1) / stats.totalMembers) * 100)
                    : 0}%
                </p>
                <p className="text-xs text-muted-foreground">Taux participation pronos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
