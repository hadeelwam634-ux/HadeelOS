import { requireAuth } from "../auth";
import { Route } from "../router";
import { connectCalendarBodySchema } from "../schemas";
import { toPublicCalendarConnection } from "../../calendar";

/**
 * v1 scope: connect accepts a token pair the client already obtained by
 * completing Google's OAuth consent flow itself — this route never
 * brokers or initiates that exchange (see README "Google Calendar
 * Integration (PR #13)" for the documented limitation).
 */
export const connectCalendarRoute: Route = {
  method: "POST",
  pattern: "/api/calendar/connect",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const body = connectCalendarBodySchema.parse(ctx.body);
    const services = container.forUser(auth.userId);
    await services.calendarSignalService.connect({
      userId: auth.userId,
      calendarId: body.calendarId,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      expiresAt: body.expiresAt,
    });
    const connection = await services.calendarSignalService.getConnection(auth.userId);
    return {
      status: 200,
      body: { connection: connection === null ? null : toPublicCalendarConnection(connection) },
    };
  },
};

export const getCalendarConnectionRoute: Route = {
  method: "GET",
  pattern: "/api/calendar/connection",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const services = container.forUser(auth.userId);
    const connection = await services.calendarSignalService.getConnection(auth.userId);
    return {
      status: 200,
      body: { connection: connection === null ? null : toPublicCalendarConnection(connection) },
    };
  },
};

export const disconnectCalendarRoute: Route = {
  method: "DELETE",
  pattern: "/api/calendar/connection",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const services = container.forUser(auth.userId);
    await services.calendarSignalService.disconnect(auth.userId);
    return { status: 200, body: { disconnected: true } };
  },
};

/**
 * Read-only sync: reads a 24-hour window of upcoming events from the
 * provider and persists only the derived meeting_count signal — never
 * the raw event content (data minimization; see CalendarSignalService).
 */
export const syncCalendarRoute: Route = {
  method: "POST",
  pattern: "/api/calendar/sync",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const services = container.forUser(auth.userId);
    const result = await services.calendarSignalService.sync(auth.userId);
    return { status: 200, body: result };
  },
};
