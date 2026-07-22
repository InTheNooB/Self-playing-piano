import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

const LoginPage = () => (
  <main className="centered-page">
    <form className="auth-card" action={async (formData) => {
      "use server";
      try {
        await signIn("credentials", {
          username: formData.get("username"),
          password: formData.get("password"),
          redirectTo: "/admin",
        });
      } catch (error) {
        if (error instanceof AuthError) redirect("/login?error=1");
        throw error;
      }
    }}>
      <p className="eyebrow">Private area</p>
      <h1>Library administration</h1>
      <label>Username<input name="username" autoComplete="username" required defaultValue="admin" /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="primary-button" type="submit">Sign in</button>
    </form>
  </main>
);

export default LoginPage;
