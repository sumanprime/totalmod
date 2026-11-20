import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TotalmodWidget } from "@/components/totalmod-widget";
import { getCurrentUser } from "@/lib/auth";
import { getMode, isScriptedDemo } from "@/lib/mode";
import { signOutAction } from "./actions";
import "./globals.css";

// Every page reads the session cookie and the database; nothing is prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notes · totalmod demo",
  description: "A small notes app wired to totalmod.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const mock = getMode() === "mock";
  const scripted = isScriptedDemo() && !mock;
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body>
        {mock && (
          <p className="banner" role="status">
            Preview with mock data. Nothing here is real, and nothing you do here reaches
            production.
          </p>
        )}
        {scripted && (
          <p className="banner" role="note">
            A scripted demo: the AI and the build are simulated, so every request becomes the same
            word-count feature. Notes are kept in a shared demo database, so don&apos;t add anything
            private.
          </p>
        )}
        <header className="header">
          <a href="/" className="brand">
            Notes
          </a>
          {user && (
            <form action={signOutAction} className="who">
              <span>
                {user.name} <span className="muted">· {user.plan}</span>
              </span>
              <button type="submit" className="link">
                Sign out
              </button>
            </form>
          )}
        </header>
        <main className="main">{children}</main>
        {user && !mock && <TotalmodWidget {...(scripted ? { pollMs: 2_000 } : {})} />}
      </body>
    </html>
  );
}
