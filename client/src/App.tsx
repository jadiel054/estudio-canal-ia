import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import Workspace from "@/pages/Workspace";
import { StudioProvider } from "@/store/StudioStore";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function Router() {
  return <Switch>
    <Route path="/" component={() => <Workspace section="home" />} />
    <Route path="/radar" component={() => <Workspace section="radar" />} />
    <Route path="/pautas" component={() => <Workspace section="pautas" />} />
    <Route path="/roteiros" component={() => <Workspace section="roteiros" />} />
    <Route path="/estudio" component={() => <Workspace section="estudio" />} />
    <Route path="/fila" component={() => <Workspace section="fila" />} />
    <Route path="/publicacoes" component={() => <Workspace section="publicacoes" />} />
    <Route path="/lives" component={() => <Workspace section="lives" />} />
    <Route path="/analytics" component={() => <Workspace section="analytics" />} />
    <Route path="/agente" component={() => <Workspace section="agente" />} />
    <Route path="/integracoes" component={() => <Workspace section="integracoes" />} />
    <Route path="/configuracoes" component={() => <Workspace section="configuracoes" />} />
    <Route path="/logs" component={() => <Workspace section="logs" />} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><StudioProvider><Toaster richColors position="top-center" /><Router /></StudioProvider></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
