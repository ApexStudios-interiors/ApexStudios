import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { mfaStep, safeNext } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/features/auth/actions";
import { MfaEnroll } from "@/features/auth/components/MfaEnroll";
import { TotpCodeForm } from "@/features/auth/components/TotpCodeForm";
import { Card } from "@/components/ui/Card";

/**
 * D22: where an owner/admin without an aal2 session is sent — by the login
 * form, and by the app shell (app/(app)/layout.tsx) for a session that is
 * already open. Sets up TOTP if they have no factor yet, otherwise asks for a
 * code. Anyone who doesn't need this step is sent straight on.
 */
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);

  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent("/mfa")}`);

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp[0];

  const step = mfaStep({ role: session.role, aal: session.aal, hasVerifiedTotp: Boolean(verified) });
  if (step === "none") redirect(next);

  return (
    <Card className="p-5">
      {step === "enroll" ? (
        <>
          <h1 className="text-[17px] font-bold tracking-tight mb-1">Set up two-factor authentication</h1>
          <p className="text-[13px] text-muted-foreground mb-4">
            Owner and admin accounts need a code from an authenticator app each time they sign in.
          </p>
          <MfaEnroll next={next} />
        </>
      ) : (
        <>
          <h1 className="text-[17px] font-bold tracking-tight mb-1">Enter your code</h1>
          <p className="text-[13px] text-muted-foreground mb-4">
            Open your authenticator app and enter the 6-digit code.
          </p>
          {verified && <TotpCodeForm factorId={verified.id} next={next} submitLabel="Verify" />}
        </>
      )}
      <form action={signOut} className="mt-4 text-center">
        <button type="submit" className="text-[12.5px] text-muted-foreground underline">
          Sign out
        </button>
      </form>
    </Card>
  );
}
