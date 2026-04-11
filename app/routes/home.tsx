import { Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/home";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Penya Blaugrana Nantes — Communauté culer" },
    {
      name: "description",
      content:
        "Rejoins la communauté des supporters du FC Barcelone à Nantes. Pronostics gratuits, soirées match au bar, et bienveillance culer.",
    },
  ];
}

export default function Home() {
  const rootData = useRouteLoaderData("root") as {
    user: { name: string; pseudo?: string | null } | null;
  } | undefined;
  const user = rootData?.user ?? null;

  return (
    <main>
      {/* Hero */}
      <section className="bg-secondary text-white py-16 px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Penya Blaugrana Nantes
          </h1>
          <p className="mt-4 text-lg text-white/90">
            La communauté des culers nantais. On regarde les matchs ensemble, on
            pronostique, on vibre — et surtout, on rigole.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {user ? (
              <Button
                asChild
                size="lg"
                className="bg-accent text-foreground hover:bg-accent/90 font-semibold"
              >
                <Link to="/espace-membre">Accéder à mon espace</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg" className="bg-primary hover:bg-primary/90">
                  <Link to="/inscription">Rejoindre la communauté</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="border-accent text-accent hover:bg-accent/10"
                >
                  <Link to="/connexion">Se connecter</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Valeurs */}
      <section className="py-16 px-4 bg-background">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold text-center text-foreground mb-8">
            Nos valeurs
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl mb-3" aria-hidden="true">
                  &#x2764;
                </div>
                <h3 className="font-semibold text-primary text-lg">
                  Bienveillance
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Pas besoin de connaître le XI de 2009. Fan depuis 20 ans ou 2
                  semaines, tout le monde est bienvenu.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl mb-3" aria-hidden="true">
                  &#x1F60A;
                </div>
                <h3 className="font-semibold text-primary text-lg">
                  Légèreté
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Le ton est fun, décontracté, jamais agressif. On chambre, on
                  rigole, zéro prise de tête.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl mb-3" aria-hidden="true">
                  &#x1F6AA;
                </div>
                <h3 className="font-semibold text-primary text-lg">
                  Ouverture
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  La porte est toujours ouverte. Viens comme tu es, traîne, vois
                  l'ambiance. Aucune pression.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Comment ça marche */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold text-center text-foreground mb-8">
            Comment ça marche ?
          </h2>
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white font-bold text-xl">
                1
              </div>
              <h3 className="mt-3 font-semibold text-foreground">
                Inscris-toi
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Crée ton compte en 2 minutes. Gratuit, 20€/an pour la Penya.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-white font-bold text-xl">
                2
              </div>
              <h3 className="mt-3 font-semibold text-foreground">
                Pronostique
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Soumets tes pronos avant chaque match. Grimpe au classement et
                gagne la gloire.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-foreground font-bold text-xl">
                3
              </div>
              <h3 className="mt-3 font-semibold text-foreground">
                Vis les matchs
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Retrouve-nous au Bar Solo Nantais. Maillots, hymne, pronos à
                l'écran — l'ambiance Camp Nou.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-16 px-4 bg-primary text-white">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold">
            {user
              ? `Content de te revoir, ${user.pseudo || user.name} !`
              : "Prêt à devenir culer nantais ?"}
          </h2>
          <p className="mt-3 text-white/90">
            {user
              ? "Chaque soir de match est une fête. On t'attend au Bar Solo."
              : "Rejoins une bande de passionnés bienveillants. Ici, chaque soir de match est une fête."}
          </p>
          {!user && (
            <Button
              asChild
              size="lg"
              className="mt-6 bg-white text-primary hover:bg-white/90 font-semibold"
            >
              <Link to="/inscription">Rejoindre la Penya</Link>
            </Button>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 px-4 border-t border-border bg-card">
        <div className="mx-auto max-w-4xl text-center text-sm text-muted-foreground">
          <p>
            Penya Blaugrana Nantes — Communauté de supporters du FC Barcelone
          </p>
          <p className="mt-1">Bar Solo Nantais — Nantes, France</p>
        </div>
      </footer>
    </main>
  );
}
