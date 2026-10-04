"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { initialFormState, type FormState } from "@/lib/master-data/form-state";
import { buttonClass } from "./form-styles";

type Props = {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
  /** Kosongkan form setelah sukses (untuk form tambah data). */
  resetOnSuccess?: boolean;
  className?: string;
};

/**
 * Form yang memanggil server action dan menampilkan hasilnya (sukses / pesan error).
 * Submit ditangani manual (bukan action={...}) supaya React 19 tidak mengosongkan isian
 * ketika validasi gagal: admin tidak perlu mengetik ulang.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  resetOnSuccess = false,
  className,
}: Props) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.status === "success") formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => {
      formAction(formData);
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Menyimpan..." : submitLabel}
        </button>
        {state.status === "success" ? (
          <span role="status" className="text-sm text-green-600">
            {state.message}
          </span>
        ) : null}
        {state.status === "error" ? (
          <span role="alert" className="text-sm text-red-600">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
