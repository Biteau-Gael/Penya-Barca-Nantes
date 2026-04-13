import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { signOut } from "~/lib/auth.client";

interface HeaderProps {
  user: { name: string; pseudo?: string | null; role?: string } | null;
}

function MenuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

const NAV_LINKS = [
  { to: "/calendrier", label: "Calendrier" },
  { to: "/fil", label: "Fil" },
  { to: "/classement", label: "Classement" },
  { to: "/liga", label: "Liga" },
  { to: "/membres", label: "Membres" },
  { to: "/evenements", label: "Événements" },
  { to: "/badges", label: "Badges" },
];

export function Header({ user }: HeaderProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    navigate("/");
  }

  return (
    <header className="border-b border-border bg-card relative">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/" className="text-lg font-bold text-primary">
          Penya Barca Nantes
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-3">
          {user ? (
            <>
              {NAV_LINKS.map((link) => (
                <Link key={link.to} to={link.to} className="text-sm text-foreground hover:text-primary">
                  {link.label}
                </Link>
              ))}
              {user.role === "admin" && (
                <Link to="/admin/dashboard" className="text-sm text-accent hover:text-accent/80 font-medium">
                  Admin
                </Link>
              )}
              <Link to="/profil" className="text-sm text-foreground hover:text-primary">
                {user.pseudo || user.name}
              </Link>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                Déconnexion
              </Button>
            </>
          ) : (
            <>
              <Link to="/calendrier" className="text-sm text-foreground hover:text-primary">
                Calendrier
              </Link>
              <Link to="/connexion" className="text-sm text-foreground hover:text-primary">
                Connexion
              </Link>
              <Button asChild size="sm">
                <Link to="/inscription">S'inscrire</Link>
              </Button>
            </>
          )}
        </nav>

        {/* Mobile: burger button */}
        <div className="flex items-center gap-2 sm:hidden">
          {user && (
            <Link to="/profil" className="text-sm text-foreground hover:text-primary">
              {user.pseudo || user.name}
            </Link>
          )}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 rounded-md text-foreground hover:bg-muted transition-colors"
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {menuOpen && (
        <div className="sm:hidden border-t border-border bg-card absolute left-0 right-0 z-50 shadow-lg">
          <nav className="flex flex-col px-4 py-3 gap-1">
            {user ? (
              <>
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMenuOpen(false)}
                    className="py-2.5 px-3 rounded-md text-sm text-foreground hover:bg-muted transition-colors"
                  >
                    {link.label}
                  </Link>
                ))}
                {user.role === "admin" && (
                  <Link
                    to="/admin/dashboard"
                    onClick={() => setMenuOpen(false)}
                    className="py-2.5 px-3 rounded-md text-sm text-accent font-medium hover:bg-muted transition-colors"
                  >
                    Admin
                  </Link>
                )}
                <div className="border-t border-border mt-1 pt-2">
                  <button
                    onClick={handleSignOut}
                    className="w-full py-2.5 px-3 rounded-md text-sm text-left text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Déconnexion
                  </button>
                </div>
              </>
            ) : (
              <>
                <Link
                  to="/calendrier"
                  onClick={() => setMenuOpen(false)}
                  className="py-2.5 px-3 rounded-md text-sm text-foreground hover:bg-muted transition-colors"
                >
                  Calendrier
                </Link>
                <Link
                  to="/connexion"
                  onClick={() => setMenuOpen(false)}
                  className="py-2.5 px-3 rounded-md text-sm text-foreground hover:bg-muted transition-colors"
                >
                  Connexion
                </Link>
                <Link
                  to="/inscription"
                  onClick={() => setMenuOpen(false)}
                  className="py-2.5 px-3 rounded-md text-sm text-primary font-medium hover:bg-muted transition-colors"
                >
                  S'inscrire
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
