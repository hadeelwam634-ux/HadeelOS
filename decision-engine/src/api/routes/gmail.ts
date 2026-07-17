import { requireAuth } from "../auth";
import { Route } from "../router";
import { connectGmailBodySchema } from "../schemas";
import { toPublicGmailConnection } from "../../gmail";

/**
 * v1 scope: connect accepts a token pair the client already obtained by
 * completing Google's OAuth consent flow itself — this route never
 * brokers or initiates that exchange (same model as the Calendar
 * integration, PR #13; see README "Gmail Integration (PR #14)").
 */
export const connectGmailRoute: Route = {
  method: "POST",
  pattern: "/api/gmail/connect",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const body = connectGmailBodySchema.parse(ctx.body);
    const services = container.forUser(auth.userId);
    await services.gmailSignalService.connect({
      userId: auth.userId,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      expiresAt: body.expiresAt,
    });
    const connection = await services.gmailSignalService.getConnection(auth.userId);
    return {
      status: 200,
      body: { connection: connection === null ? null : toPublicGmailConnection(connection) },
    };
  },
};

export const getGmailConnectionRoute: Route = {
  method: "GET",
  pattern: "/api/gmail/connection",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const services = container.forUser(auth.userId);
    const connection = await services.gmailSignalService.getConnection(auth.userId);
    return {
      status: 200,
      body: { connection: connection === null ? null : toPublicGmailConnection(connection) },
    };
  },
};

export const disconnectGmailRoute: Route = {
  method: "DELETE",
  pattern: "/api/gmail/connection",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const services = container.forUser(auth.userId);
    await services.gmailSignalService.disconnect(auth.userId);
    return { status: 200, body: { disconnected: true } };
  },
};

/**
 * Read-only sync: counts unread inbox messages via the provider and
 * persists only the derived count as a signal — never any message
 * subject, sender, or body (data minimization; see GmailSignalService
 * and GmailProvider's doc comments).
 */
export const syncGmailRoute: Route = {
  method: "POST",
  pattern: "/api/gmail/sync",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const services = container.forUser(auth.userId);
    const result = await services.gmailSignalService.sync(auth.userId);
    return { status: 200, body: result };
  },
};
