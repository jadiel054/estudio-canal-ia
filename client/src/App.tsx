import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import Workspace from "@/pages/Workspace";
import LoginPage from "@/pages/Login";
import AnalyticsRoute from "@/pages/studio/AnalyticsPage";
import LivesRoute from "@/pages/studio/LivesPage";
import LogsRoute from "@/pages/studio/LogsPage";
import { StudioProvider } from "@/store/StudioStore";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";

function Router() {
  return <Switch>
    <Route path="/" component={() => <Workspace section="home" />} />
    <Route path="/radar" component={() => <Workspace section="radar" />} />
    <Route path="/pautas" component={() => <Workspace section="pautas" />} />
    <Route path="/roteiros" component={() => <Workspace section="roteiros" />} />
    <Route path="/estudio" component={() => <Workspace section="estudio" />} />
    <Route path="/fila" component={() => <Workspace section="fila" />} />
    <Route path="/publicacoes" component={() => <Workspace section="publicacoes" />} />
    <Route path="/lives" component={LivesRoute} />
    <Route path="/analytics" component={AnalyticsRoute} />
    <Route path="/agente" component={() => <Workspace section="agente" />} />
    <Route path="/integracoes" component={() => <Workspace section="integracoes" />} />
    <Route path="/configuracoes" component={() => <Workspace section="configuracoes" />} />
    <Route path="/logs" component={LogsRoute} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><AuthGate /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

function AuthGate() {
  const auth = useAuth();
  if (auth.loading) return <main className="grid min-h-screen place-items-center bg-[#090d17] text-sm text-[#9ba7bd]">Verificando sessão…</main>;
  if (!auth.isAuthenticated) return <LoginPage />;
  return <StudioProvider><Toaster richColors position="top-center" /><Router /></StudioProvider>;
}
