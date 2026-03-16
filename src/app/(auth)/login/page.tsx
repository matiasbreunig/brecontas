"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Email ou senha incorretos");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500 shadow-lg shadow-indigo-500/30">
            <Wallet className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Brecontas</h1>
          <p className="mt-1 text-sm text-indigo-200/60">Controle pessoal de contas</p>
        </div>

        <div className="rounded-2xl bg-white/[0.08] backdrop-blur-xl border border-white/[0.08] p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-indigo-100/80">
                Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="seu@email.com"
                required
                className="bg-white/[0.06] border-white/[0.1] text-white placeholder:text-white/30 focus:border-indigo-400 focus:ring-indigo-400/20 h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-indigo-100/80">
                Senha
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                className="bg-white/[0.06] border-white/[0.1] text-white placeholder:text-white/30 focus:border-indigo-400 focus:ring-indigo-400/20 h-11"
              />
            </div>
            {error && (
              <p className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full h-11 bg-indigo-500 hover:bg-indigo-400 text-white font-medium shadow-lg shadow-indigo-500/25 transition-all"
              disabled={loading}
            >
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
