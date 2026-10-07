import { signOutAction } from "@/app/login/actions";
import { Icon } from "./icons";

export function SignOutButton({ onDark = false }: { onDark?: boolean }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium ${
          onDark ? "text-white/80 hover:bg-white/10" : "text-muted hover:bg-neutral-soft"
        }`}
      >
        <Icon name="logout" className="h-4 w-4" />
        Keluar
      </button>
    </form>
  );
}
