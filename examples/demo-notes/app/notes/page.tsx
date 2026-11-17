import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { createNoteAction } from "../actions";

const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export default async function Notes({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const { error } = await searchParams;

  const db = await getDb();
  const rows = await db
    .select()
    .from(notes)
    .where(eq(notes.userId, user.id))
    .orderBy(desc(notes.updatedAt), desc(notes.id));

  return (
    <>
      <section className="card">
        <h1>New note</h1>
        <form action={createNoteAction} className="stack">
          <label htmlFor="title">Title</label>
          <input id="title" name="title" maxLength={200} required />
          <label htmlFor="body">Body</label>
          <textarea id="body" name="body" rows={3} maxLength={10_000} />
          {error === "title" && <p className="error">Give the note a title.</p>}
          <button type="submit">Add note</button>
        </form>
      </section>

      <section aria-labelledby="your-notes">
        <h2 id="your-notes">
          Your notes <span className="muted">({rows.length})</span>
        </h2>
        {rows.length === 0 ? (
          <p className="muted">No notes yet.</p>
        ) : (
          <ul className="notes">
            {rows.map((note) => (
              <li key={note.id} className="card note">
                <Link href={`/notes/${note.id}`} className="note-title">
                  {note.title}
                </Link>
                {note.body && <p className="note-body">{note.body}</p>}
                <p className="muted small">Updated {date.format(note.updatedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
