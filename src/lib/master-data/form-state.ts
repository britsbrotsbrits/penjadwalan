/** State hasil server action untuk form (dipakai useActionState). */
export type FormState =
  | { status: "idle"; message: "" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export const initialFormState: FormState = { status: "idle", message: "" };

export function ok(message: string): FormState {
  return { status: "success", message };
}

export function fail(message: string): FormState {
  return { status: "error", message };
}
