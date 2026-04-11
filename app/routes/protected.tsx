import { redirect } from "react-router";
import { requireAuth } from "~/lib/server/auth-utils.server";

export async function loader({ request }: { request: Request }) {
  try {
    await requireAuth(request);
    throw redirect("/profil");
  } catch (error) {
    if (error instanceof Response) throw error;
    throw redirect("/connexion");
  }
}

export default function Protected() {
  return null;
}
