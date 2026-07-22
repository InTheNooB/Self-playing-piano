import Link from "next/link";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

interface LoginPageProps {
  searchParams: Promise<{ admin?: string; callbackUrl?: string; error?: string }>;
}

const LoginPage = async ({ searchParams }: LoginPageProps) => {
  const parameters = await searchParams;
  const administrator = parameters.admin === "1";
  const redirectTo = administrator ? "/admin" : "/";

  return (
    <main className="centered-page">
      <form className="auth-card" action={async (formData) => {
        "use server";
        try {
          await signIn("credentials", {
            username: administrator ? formData.get("username") : "__piano_controller__",
            password: formData.get("password"),
            redirectTo,
          });
        } catch (error) {
          if (error instanceof AuthError) redirect(`/login?${administrator ? "admin=1&" : ""}error=1`);
          throw error;
        }
      }}>
        <p className="eyebrow">{administrator ? "Private area" : "House piano"}</p>
        <h1>{administrator ? "Library administration" : "Unlock the controls"}</h1>
        {administrator && <label>Username<input name="username" autoComplete="username" required defaultValue="admin" /></label>}
        <label>{administrator ? "Password" : "Shared password"}<input name="password" type="password" autoComplete="current-password" required autoFocus /></label>
        {parameters.error && <p className="inline-message">The password was not accepted.</p>}
        <button className="primary-button" type="submit">{administrator ? "Sign in" : "Unlock"}</button>
        <Link href={administrator ? "/login" : "/login?admin=1"}>{administrator ? "Use the shared piano password" : "Administrator sign-in"}</Link>
      </form>
    </main>
  );
};

export default LoginPage;
