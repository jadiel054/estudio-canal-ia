import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorCode: string | null;
}

function supportCodeFromError(error: unknown): string {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const compact = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase() || "UNKNOWN";
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `UI_${compact}_${stamp}`;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorCode: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorCode: supportCodeFromError(error) };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", this.state.errorCode, error.name);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0b1220] p-8">
          <div className="flex w-full max-w-md flex-col items-center rounded-2xl border border-[#ff7b70]/20 bg-[#111827]/90 p-8 text-center shadow-[0_16px_50px_rgba(0,0,0,.35)]">
            <AlertTriangle size={40} className="mb-5 flex-shrink-0 text-[#ffaaa3]" aria-hidden />
            <h2 className="text-lg font-black text-white">Ocorreu um erro inesperado</h2>
            <p className="mt-3 text-sm leading-6 text-[#9ba7bd]">
              A interface encontrou um problema e precisou parar esta tela. Seus dados no servidor n\u00e3o
              foram alterados por este erro.
            </p>
            {this.state.errorCode ? (
              <p className="mt-3 font-mono text-[11px] uppercase tracking-wide text-[#8e9bb0]">
                C\u00f3digo de suporte: {this.state.errorCode}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={cn(
                "mt-6 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black",
                "bg-[#c6ff4d] text-[#111827] hover:opacity-90",
              )}
            >
              <RotateCcw size={16} aria-hidden />
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
