import { Hono } from "hono";
import { requestClientMeta, writeAuditLog } from "../services/auditLog.js";
import {
  changeUserPassword,
  getUserSession,
  loginUser,
  logoutUser,
} from "../services/userAuth.js";

export const authRoute = new Hono();

authRoute.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const username = String(body?.username ?? "");
  const password = String(body?.password ?? "");
  const client = requestClientMeta(c);
  const result = await loginUser(username, password);
  if ("error" in result) {
    writeAuditLog({
      username: username.trim() || "(blank)",
      action: "auth.login",
      outcome: "FAILURE",
      summary: "Invalid credentials",
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return c.json(result, 401);
  }
  writeAuditLog({
    userId: result.user.id,
    username: result.user.username,
    role: result.user.role,
    action: "auth.login",
    outcome: "SUCCESS",
    summary: "Signed in",
    ip: client.ip,
    userAgent: client.userAgent,
  });
  return c.json(result);
});

authRoute.post("/session", async (c) => {
  const body = await c.req.json().catch(() => null);
  const token =
    typeof body?.token === "string"
      ? body.token
      : c.req.header("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const session = await getUserSession(token);
  if (!session) {
    return c.json(null);
  }
  return c.json(session);
});

authRoute.post("/logout", async (c) => {
  const body = await c.req.json().catch(() => null);
  const token =
    typeof body?.token === "string"
      ? body.token
      : c.req.header("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const client = requestClientMeta(c);
  const session = token ? await getUserSession(token) : null;
  await logoutUser(token);
  if (session) {
    writeAuditLog({
      userId: session.user.id,
      username: session.user.username,
      role: session.user.role,
      action: "auth.logout",
      outcome: "SUCCESS",
      summary: "Signed out",
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }
  return c.json({ ok: true });
});

authRoute.post("/change-password", async (c) => {
  const body = await c.req.json().catch(() => null);
  const token =
    typeof body?.authToken === "string"
      ? body.authToken
      : c.req.header("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const result = await changeUserPassword({
    token,
    currentPassword: String(body?.currentPassword ?? ""),
    newPassword: String(body?.newPassword ?? ""),
  });
  if ("error" in result) {
    return c.json(result, 400);
  }
  return c.json(result);
});
