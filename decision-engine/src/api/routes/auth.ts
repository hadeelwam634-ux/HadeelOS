import { AuthService } from "../../auth";
import { loginBodySchema, logoutBodySchema, registerBodySchema } from "../schemas";
import { Route } from "../router";

/**
 * Auth routes are built by a factory (rather than exported as static
 * Route objects like every other route file) because they close over a
 * single shared AuthService instance instead of the per-user
 * AppContainer every other route receives as its second handler
 * argument — there is no authenticated user yet when register/login
 * run, so there is nothing to look up in AppContainer for them.
 */
export function createAuthRoutes(authService: AuthService): Route[] {
  const register: Route = {
    method: "POST",
    pattern: "/api/auth/register",
    public: true,
    handler: async (ctx) => {
      const body = registerBodySchema.parse(ctx.body);
      const result = await authService.register(body.email, body.password);
      return { status: 201, body: result };
    },
  };

  const login: Route = {
    method: "POST",
    pattern: "/api/auth/login",
    public: true,
    handler: async (ctx) => {
      const body = loginBodySchema.parse(ctx.body);
      const result = await authService.login(body.email, body.password);
      return { status: 200, body: result };
    },
  };

  const logout: Route = {
    method: "POST",
    pattern: "/api/auth/logout",
    public: true,
    handler: async (ctx) => {
      const body = logoutBodySchema.parse(ctx.body);
      await authService.logout(body.token);
      return { status: 200, body: { loggedOut: true } };
    },
  };

  return [register, login, logout];
}
