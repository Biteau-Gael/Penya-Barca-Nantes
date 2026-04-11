import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { signUp } from "~/lib/auth.client";
import { registerSchema } from "~/lib/validation/user";

interface FieldErrors {
  email?: string;
  pseudo?: string;
  password?: string;
  confirmPassword?: string;
  gdprConsent?: string;
  form?: string;
}

export default function Register() {
  const navigate = useNavigate();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const raw = {
      email: formData.get("email") as string,
      pseudo: formData.get("pseudo") as string,
      password: formData.get("password") as string,
      confirmPassword: formData.get("confirmPassword") as string,
      gdprConsent: formData.get("gdprConsent") === "on" ? true as const : false as const,
    };

    // Client-side validation
    const result = registerSchema.safeParse(raw);
    if (!result.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      setErrors(fieldErrors);
      setLoading(false);
      return;
    }

    // Call Better Auth signup
    const { error } = await signUp.email({
      email: raw.email,
      password: raw.password,
      name: raw.pseudo,
      pseudo: raw.pseudo,
      gdprConsent: true,
    });

    if (error) {
      setErrors({ form: "Une erreur est survenue lors de l'inscription" });
      setLoading(false);
      return;
    }

    navigate("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-primary">
            Rejoindre la Penya
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Crée ton compte et rejoins la communauté culer nantaise
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {errors.form && (
              <div
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              >
                {errors.form}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                aria-describedby={errors.email ? "email-error" : undefined}
                aria-invalid={!!errors.email}
              />
              {errors.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {errors.email}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="pseudo">Pseudo</Label>
              <Input
                id="pseudo"
                name="pseudo"
                type="text"
                autoComplete="username"
                required
                aria-describedby={errors.pseudo ? "pseudo-error" : undefined}
                aria-invalid={!!errors.pseudo}
              />
              {errors.pseudo && (
                <p id="pseudo-error" className="text-sm text-destructive">
                  {errors.pseudo}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                aria-describedby={errors.password ? "password-error" : undefined}
                aria-invalid={!!errors.password}
              />
              {errors.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {errors.password}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmer le mot de passe</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                aria-describedby={
                  errors.confirmPassword ? "confirm-error" : undefined
                }
                aria-invalid={!!errors.confirmPassword}
              />
              {errors.confirmPassword && (
                <p id="confirm-error" className="text-sm text-destructive">
                  {errors.confirmPassword}
                </p>
              )}
            </div>

            <div className="flex items-start space-x-2">
              <input
                id="gdprConsent"
                name="gdprConsent"
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-input"
                required
                aria-describedby={
                  errors.gdprConsent ? "gdpr-error" : undefined
                }
                aria-invalid={!!errors.gdprConsent}
              />
              <Label htmlFor="gdprConsent" className="text-sm leading-5">
                J'accepte la{" "}
                <span className="text-primary underline">
                  politique de confidentialité
                </span>{" "}
                et le traitement de mes données personnelles
              </Label>
            </div>
            {errors.gdprConsent && (
              <p id="gdpr-error" className="text-sm text-destructive">
                {errors.gdprConsent}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Inscription en cours..." : "S'inscrire"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Déjà membre ?{" "}
              <Link to="/connexion" className="text-primary underline">
                Se connecter
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
