import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { Header } from "~/components/layout/header";
import { WelcomeNotification } from "./components/shared/welcome-notification";
import { getSession } from "~/lib/server/auth-utils.server";
import { db } from "~/db/client";
import { user } from "~/db/schema";
import { eq } from "drizzle-orm";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  if (!session?.user) {
    return { user: null };
  }

  // Lire les données à jour depuis la DB (pas depuis le cache session)
  const [userData] = await db
    .select({ pseudo: user.pseudo, name: user.name, welcomeShown: user.welcomeShown, role: user.role })
    .from(user)
    .where(eq(user.id, session.user.id));

  return {
    user: userData
      ? { name: userData.name, pseudo: userData.pseudo, welcomeShown: userData.welcomeShown, role: userData.role }
      : { name: session.user.name, pseudo: null, welcomeShown: true, role: "member" },
  };
}

export default function App() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <>
      <Header user={user} />
      {user && !user.welcomeShown && <WelcomeNotification />}
      <Outlet />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
