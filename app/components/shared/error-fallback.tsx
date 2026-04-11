import { useRouteError, isRouteErrorResponse } from "react-router";

export function ErrorFallback() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-primary">{error.status}</h1>
          <p className="mt-2 text-lg text-muted">{error.statusText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-primary">Oups !</h1>
        <p className="mt-2 text-lg text-muted">
          Une erreur inattendue est survenue.
        </p>
      </div>
    </div>
  );
}
