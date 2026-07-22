import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Piano House",
  description: "Choose a song and let the self-playing piano perform it.",
};

const RootLayout = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <html lang="en">
    <body>
      <header className="site-header">
        <Link className="brand" href="/"><span className="brand-mark">P</span><span>Piano House</span></Link>
        <nav><Link href="/">Library</Link><Link href="/admin">Admin</Link></nav>
      </header>
      {children}
    </body>
  </html>
);

export default RootLayout;
