import { Link, useLocation } from "wouter";
import {
  Activity, BarChart3, Bot, CalendarDays, ChevronRight, CircleDollarSign, FilePenLine,
  Home, Layers3, Menu, MoreHorizontal, Radar, RadioTower, Settings2, ShieldCheck,
  Sparkles, Workflow, X,
} from "lucide-react";
import { useState } from "react";

export type Section =
  | "home" | "radar" | "pautas" | "roteiros" | "estudio" | "fila"
  | "publicacoes" | "lives" | "analytics" | "agente" | "integracoes" | "configuracoes" | "logs";

type NavItem = { id: Section; label: string; href: string; icon: typeof Home; group?: string };

export const navItems: NavItem[] = [
  { id: "home", label: "Início", href: "/", icon: Home },
  { id: "radar", label: "Radar", href: "/radar", icon: Radar },
  { id: "pautas", label: "Pautas", href: "/pautas", icon: Layers3 },
  { id: "roteiros", label: "Roteiros", href: "/roteiros", icon: FilePenLine },
  { id: "estudio", label: "Estúdio", href: "/estudio", icon: Sparkles },
  { id: "fila", label: "Fila", href: "/fila", icon: Workflow },
  { id: "publicacoes", label: "Publicações", href: "/publicacoes", icon: CalendarDays, group: "Mais" },
  { id: "lives", label: "Lives", href: "/lives", icon: RadioTower, group: "Mais" },
  { id: "analytics", label: "Analytics", href: "/analytics", icon: BarChart3, group: "Mais" },
  { id: "agente", label: "Nexo", href: "/agente", icon: Bot, group: "Mais" },
  { id: "integracoes", label: "Integrações", href: "/integracoes", icon: ShieldCheck, group: "Sistema" },
  { id: "configuracoes", label: "Configurações", href: "/configuracoes", icon: Settings2, group: "Sistema" },
  { id: "logs", label: "Logs e custos", href: "/logs", icon: CircleDollarSign, group: "Sistema" },
];

const primary = navItems.filter(item => ["home", "radar", "estudio", "fila"].includes(item.id));

export function StudioShell({ children, section }: { children: React.ReactNode; section: Section }) {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const extras = navItems.filter(item => !primary.some(primaryItem => primaryItem.id === item.id));

  return (
    <div className="min-h-screen bg-[#090d17] text-[#eaf0ff] selection:bg-[#c6ff4d] selection:text-[#101421]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[254px] border-r border-white/7 bg-[#0d1220]/95 px-4 py-5 lg:flex lg:flex-col">
        <Brand />
        <nav className="mt-9 space-y-1" aria-label="Navegação principal">
          {navItems.map(item => <DesktopNavItem key={item.id} item={item} active={section === item.id} />)}
        </nav>
        <div className="mt-auto rounded-2xl border border-[#c6ff4d]/15 bg-[#c6ff4d]/[0.06] p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#c6ff4d]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#c6ff4d]" />NEXO · OPERACIONAL</div>
          <p className="mt-2 text-xs leading-5 text-[#9faac1]">Sua publicação continua protegida por dois portões humanos.</p>
        </div>
      </aside>

      <main className="pb-24 lg:ml-[254px] lg:pb-8">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/7 bg-[#090d17]/90 px-4 backdrop-blur-xl lg:hidden">
          <Brand compact />
          <Link href="/agente" className="nexo-pulse inline-flex h-10 items-center gap-2 rounded-xl border border-[#8d5cff]/40 bg-[#8d5cff]/10 px-3 text-xs font-bold text-[#d7c8ff]">
            <Bot size={15} /> Nexo
          </Link>
        </header>
        <div className="mx-auto max-w-[1440px] px-4 pt-5 sm:px-6 lg:px-9 lg:pt-8">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-[#0d1220]/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden" aria-label="Navegação inferior">
        <div className="flex items-end justify-around">
          {primary.map(item => <MobileNavItem key={item.id} item={item} active={section === item.id} />)}
          <button type="button" onClick={() => setMoreOpen(value => !value)} className={`flex min-w-[58px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-medium ${moreOpen || extras.some(item => item.id === section) ? "text-[#c6ff4d]" : "text-[#7f8aa3]"}`}>
            <MoreHorizontal size={21} /><span>Mais</span>
          </button>
        </div>
      </nav>

      {moreOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMoreOpen(false)}>
        <section className="absolute inset-x-0 bottom-0 rounded-t-[28px] border-t border-white/10 bg-[#121828] p-5 pb-[calc(1.3rem+env(safe-area-inset-bottom))] shadow-2xl" onClick={event => event.stopPropagation()}>
          <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8d5cff]">Navegação</p><h2 className="mt-1 text-lg font-bold">Mais do estúdio</h2></div><button aria-label="Fechar menu" onClick={() => setMoreOpen(false)} className="grid h-10 w-10 place-items-center rounded-xl bg-white/6 text-[#aab4ca]"><X size={19} /></button></div>
          <div className="grid grid-cols-2 gap-2">
            {extras.map(item => {
              const Icon = item.icon;
              return <Link key={item.id} href={item.href} onClick={() => setMoreOpen(false)} className={`flex min-h-20 items-center gap-3 rounded-2xl border p-3 ${section === item.id ? "border-[#c6ff4d]/45 bg-[#c6ff4d]/10 text-[#eaffc6]" : "border-white/7 bg-white/[0.035] text-[#cad3e6]"}`}><Icon size={19} /><span className="text-sm font-semibold">{item.label}</span></Link>;
            })}
          </div>
        </section>
      </div>}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="group flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#c6ff4d] to-[#8d5cff] font-black text-[#0b1020] shadow-[0_0_30px_rgba(198,255,77,.16)]">E</span>{!compact && <span><span className="block text-[15px] font-black tracking-tight">ESTÚDIO</span><span className="block text-[10px] font-bold tracking-[0.2em] text-[#8793aa]">CANAL IA</span></span>}</Link>;
}

function DesktopNavItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={[
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
        active
          ? "bg-[#c6ff4d]/10 font-bold text-[#eaffc6] shadow-[inset_0_0_0_1px_rgba(198,255,77,.12)]"
          : "font-medium text-[#92a0b9] hover:bg-white/[0.045] hover:text-[#eaf0ff]",
      ].join(" ")}
    >
      <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
      <span>{item.label}</span>
      {active && <ChevronRight className="ml-auto" size={15} />}
    </Link>
  );
}

function MobileNavItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return <Link href={item.href} className={`flex min-w-[58px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-medium ${active ? "text-[#c6ff4d]" : "text-[#7f8aa3]"}`}><Icon size={21} strokeWidth={active ? 2.5 : 1.8} /><span>{item.label}</span></Link>;
}

export function BackButton({ fallback = "/" }: { fallback?: string }) {
  const [, navigate] = useLocation();
  return <button type="button" onClick={() => history.length > 1 ? history.back() : navigate(fallback)} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#91a0b8] transition hover:text-[#eaf0ff]"><Activity size={14} className="rotate-180" /> Voltar</button>;
}
