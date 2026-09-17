"use client";

import { useEffect, useRef } from "react";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { startTotpEnrollment } from "@/features/auth/actions";
import { Button } from "@/components/ui/Button";
import { TotpCodeForm } from "./TotpCodeForm";

/**
 * D22: TOTP enrollment — scan (or type) the secret, then prove it with one
 * code. Enrollment starts once on mount; the ref stops React's dev-mode double
 * effect from enrolling twice, where the second call would remove the factor
 * the first one is still showing.
 */
export function MfaEnroll({ next }: { next: string }) {
  const router = useRouter();
  const started = useRef(false);

  const enroll = useAction(startTotpEnrollment, {
    onSuccess: ({ data }) => {
      // Enrolled in another tab meanwhile: the server page will show the
      // challenge instead.
      if (data?.alreadyEnrolled) router.refresh();
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    enroll.execute();
  }, [enroll]);

  const data = enroll.result.data;

  if (enroll.result.serverError) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-destructive">{enroll.result.serverError}</p>
        <Button onClick={() => enroll.execute()}>Try again</Button>
      </div>
    );
  }

  if (!data || data.alreadyEnrolled) {
    return <p className="text-[13px] text-muted-foreground">Preparing your setup code…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="text-[13px] text-muted-foreground list-decimal pl-4 flex flex-col gap-1">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
        <li>Scan this QR code, or enter the key below.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      {/* Always on white: a QR code needs light modules on a light ground to
          scan, whichever theme is active. Supabase returns it as an SVG data
          URL, which next/image cannot optimise anyway. */}
      <div className="self-center rounded-lg bg-white p-3 border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={data.qrCode} alt="QR code for your authenticator app" width={180} height={180} />
      </div>
      <div>
        <div className="text-[12.5px] font-semibold mb-1.5">Can&apos;t scan? Enter this key</div>
        <code className="block text-[12.5px] bg-muted rounded-md px-2.5 py-2 break-all select-all">
          {data.secret}
        </code>
      </div>
      <TotpCodeForm factorId={data.factorId} next={next} submitLabel="Turn on two-factor" />
    </div>
  );
}
