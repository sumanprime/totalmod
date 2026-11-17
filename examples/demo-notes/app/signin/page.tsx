import { getMode } from "@/lib/mode";
import { mockUsers } from "@/seed/mock";
import { signInAction } from "../actions";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const mock = getMode() === "mock";

  return (
    <section className="card narrow">
      <h1>Sign in</h1>
      <p className="muted">Demo sign-in: type any name. A new name creates a free account.</p>
      <form action={signInAction} className="stack">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" autoComplete="off" maxLength={80} required />
        {error === "name" && <p className="error">Enter a name.</p>}
        <button type="submit">Sign in</button>
      </form>

      {mock && (
        <>
          <h2>Or pick a mock user</h2>
          <ul className="users">
            {mockUsers.map((user) => (
              <li key={user.id}>
                <form action={signInAction}>
                  <input type="hidden" name="name" value={user.name} />
                  <button type="submit" className="secondary">
                    {user.name}
                    <span className="muted">
                      {" "}
                      · {user.plan} {user.role} · {user.noteCount} notes
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
