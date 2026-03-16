import { auth } from "@/server/auth";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppSidebar user={session.user} />
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto p-4 md:p-6 pb-[env(safe-area-inset-bottom,1rem)]">
          {children}
        </div>
      </main>
    </div>
  );
}
