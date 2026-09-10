import Link from "next/link";
import { Card } from "@/components/ui/Card";

/** build/03-auth-and-rbac.md §2.7: expired or already-used link, with a path back. */
export default function AuthErrorPage() {
  return (
    <Card className="p-5 text-center">
      <h1 className="text-[17px] font-bold tracking-tight mb-1">That link didn&apos;t work</h1>
      <p className="text-[13px] text-muted-foreground mb-4">
        It may have expired or already been used. Links are valid for 10 minutes.
      </p>
      <Link href="/client-login" className="underline text-foreground text-[13.5px]">
        Request a new link
      </Link>
    </Card>
  );
}
