import { Link, useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { signOut } from "~/lib/auth.client";

interface HeaderProps {
  user: { name: string; pseudo?: string | null; role?: string } | null;
}

const disabledLinkClass =
  "text-sm text-muted-foreground opacity-50 cursor-not-allowed hidden sm:inline";

export function Header({ user }: HeaderProps) {
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/" className="text-lg font-bold text-primary">
          Penya Barca Nantes
        </Link>

        <nav className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <>
              <Link
                to="/calendrier"
                className="text-sm text-foreground hover:text-primary hidden sm:inline"
              >
                Calendrier
              </Link>
              <Link
                to="/membres"
                className="text-sm text-foreground hover:text-primary hidden sm:inline"
              >
                Membres
              </Link>
              <Link
                to="/fil"
                className="text-sm text-foreground hover:text-primary hidden sm:inline"
              >
                Fil
              </Link>
              <Link
                to="/evenements"
                className="text-sm text-foreground hover:text-primary hidden sm:inline"
              >
                Événements
              </Link>
              <Link
                to="/classement"
                className="text-sm text-foreground hover:text-primary hidden sm:inline"
              >
                Classement
              </Link>
              <Link
                to="/liga"
                className="text-sm text-foreground hover:text-primary hidden sm:inline"
              >
                Liga
              </Link>
              {user.role === "admin" && (
                <Link
                  to="/admin/dashboard"
                  className="text-sm text-accent hover:text-accent/80 font-medium hidden sm:inline"
                >
                  Admin
                </Link>
              )}
              <Link
                to="/profil"
                className="text-sm text-foreground hover:text-primary"
              >
                {user.pseudo || user.name}
              </Link>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                Déconnexion
              </Button>
            </>
          ) : (
            <>
              <Link
                to="/calendrier"
                className="text-sm text-foreground hover:text-primary hidden sm:inline"
              >
                Calendrier
              </Link>
              <Link
                to="/connexion"
                className="text-sm text-foreground hover:text-primary"
              >
                Connexion
              </Link>
              <Button asChild size="sm">
                <Link to="/inscription">S'inscrire</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
