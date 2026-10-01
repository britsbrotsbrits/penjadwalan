import { signOutAction } from "@/app/login/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="text-sm underline">
        Keluar
      </button>
    </form>
  );
}
