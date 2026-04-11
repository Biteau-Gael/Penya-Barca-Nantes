import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

export function WelcomeNotification() {
  const [visible, setVisible] = useState(true);
  const fetcher = useFetcher();

  function handleDismiss() {
    setVisible(false);
    fetcher.submit(null, { method: "POST", action: "/api/welcome-dismiss" });
  }

  if (!visible) return null;

  return (
    <div className="bg-secondary/10 border-b border-secondary/20 px-4 py-4">
      <Card className="mx-auto max-w-2xl border-secondary">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-xl font-bold text-primary text-center">
            Bienvenue dans la famille culer ! 🎉
          </h2>
          <p className="text-sm text-foreground text-center">
            On est contents que tu sois là ! Voici quelques idées pour bien démarrer :
          </p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link to="/membres" className="text-secondary hover:underline font-medium">
                → Découvre les autres membres
              </Link>
            </li>
            <li>
              <Link to="/profil" className="text-secondary hover:underline font-medium">
                → Personnalise ton profil
              </Link>
            </li>
            <li>
              <span className="text-muted-foreground">
                → Le calendrier des matchs et les pronostics arrivent bientôt !
              </span>
            </li>
          </ul>
          <div className="text-center">
            <Button onClick={handleDismiss} size="sm">
              C'est parti !
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
