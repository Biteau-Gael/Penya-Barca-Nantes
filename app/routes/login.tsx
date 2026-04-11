import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { signIn } from "~/lib/auth.client";
import { loginSchema } from "~/lib/validation/user";

interface FieldErrors {
  email?: string;
  password?: string;
  form?: string;
}

export default function Login() {
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
      password: formData.get("password") as string,
    };

    const result = loginSchema.safeParse(raw);
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

    const { error } = await signIn.email({
      email: raw.email,
      password: raw.password,
    });

    if (error) {
      setErrors({ form: "Email ou mot de passe incorrect" });
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
            Connexion
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Retrouve ta communauté culer
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
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
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

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Connexion en cours..." : "Se connecter"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Pas encore membre ?{" "}
              <Link to="/inscription" className="text-primary underline">
                S'inscrire
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
