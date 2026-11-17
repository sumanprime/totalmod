"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, signInByName, signOut } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { notes } from "@/lib/db/schema";

function field(form: FormData, name: string, max: number): string {
  const value = String(form.get(name) ?? "").trim();
  return value.slice(0, max);
}

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user;
}

export async function signInAction(form: FormData) {
  const name = field(form, "name", 80);
  if (!name) redirect("/signin?error=name");
  await signInByName(name);
  redirect("/notes");
}

export async function signOutAction() {
  await signOut();
  redirect("/signin");
}

export async function createNoteAction(form: FormData) {
  const user = await requireUser();
  const title = field(form, "title", 200);
  if (!title) redirect("/notes?error=title");
  const db = await getDb();
  await db.insert(notes).values({ userId: user.id, title, body: field(form, "body", 10_000) });
  revalidatePath("/notes");
}

export async function updateNoteAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const title = field(form, "title", 200);
  if (!title) redirect(`/notes/${id}?error=title`);
  const db = await getDb();
  await db
    .update(notes)
    .set({ title, body: field(form, "body", 10_000), updatedAt: new Date() })
    .where(and(eq(notes.id, id), eq(notes.userId, user.id)));
  revalidatePath("/notes");
  redirect("/notes");
}

export async function deleteNoteAction(form: FormData) {
  const user = await requireUser();
  const db = await getDb();
  await db
    .delete(notes)
    .where(and(eq(notes.id, Number(form.get("id"))), eq(notes.userId, user.id)));
  revalidatePath("/notes");
  redirect("/notes");
}
