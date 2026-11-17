import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { deleteNoteAction, updateNoteAction } from "../../actions";

export default async function EditNote({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { error } = await searchParams;

  const db = await getDb();
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, user.id)));
  if (!note) notFound();

  return (
    <section className="card">
      <p>
        <Link href="/notes">← All notes</Link>
      </p>
      <h1>Edit note</h1>
      <form action={updateNoteAction} className="stack">
        <input type="hidden" name="id" value={note.id} />
        <label htmlFor="title">Title</label>
        <input id="title" name="title" defaultValue={note.title} maxLength={200} required />
        <label htmlFor="body">Body</label>
        <textarea id="body" name="body" rows={8} defaultValue={note.body} maxLength={10_000} />
        {error === "title" && <p className="error">Give the note a title.</p>}
        <button type="submit">Save</button>
      </form>
      <form action={deleteNoteAction} className="danger-zone">
        <input type="hidden" name="id" value={note.id} />
        <button type="submit" className="danger">
          Delete note
        </button>
      </form>
    </section>
  );
}
