import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });
export const router = t.router;
export const publicProcedure = t.procedure;

const requireOwner = t.middleware(async opts => {
  const { ctx, next } = opts;
  const allowlistedEmail = (process.env.STUDIO_OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  if (!allowlistedEmail || ctx.user.email.toLowerCase() !== allowlistedEmail || ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Owner-only procedure. All studio data, provider settings and LLM calls use this. */
export const adminProcedure = t.procedure.use(requireOwner);
/** Legacy alias retained for code that imports protectedProcedure; it is owner-only now. */
export const protectedProcedure = adminProcedure;
