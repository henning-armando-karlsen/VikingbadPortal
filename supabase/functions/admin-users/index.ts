import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};
const admin = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

  try {
    // 1. Verifiser kaller og kapabilitet (aldri stol på klienten)
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!token) return json({ error: "Mangler token" }, 401);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return json({ error: "Ugyldig token" }, 401);

    const { data: prof } = await admin.from("profiles").select("role, aktiv").eq("id", u.user.id).single();
    if (!prof || prof.aktiv === false) return json({ error: "Ingen tilgang" }, 403);
    const { data: r } = await admin.from("app_roles").select("capabilities").eq("role_key", prof.role).single();
    if (!(r?.capabilities || []).includes("admin.brukere")) return json({ error: "Krever admin.brukere" }, 403);

    // 2. Utfør handling
    const { action, payload = {} } = await req.json();
    switch (action) {
      case "list": {
        const { data, error } = await admin.from("profiles")
          .select("id, email, full_name, role, ra, aktiv, created_at").order("created_at", { ascending: true });
        if (error) throw error;
        return json({ users: data });
      }
      case "create": {
        const { email, password, full_name, role, ra } = payload;
        if (!email || !password) return json({ error: "E-post og passord er påkrevd" }, 400);
        const { data: c, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: full_name || "" },
        });
        if (error) throw error;
        const { error: pErr } = await admin.from("profiles").upsert({
          id: c.user.id, email, full_name: full_name || "", role: role || "selger", ra: ra || null, aktiv: true,
        }, { onConflict: "id" });
        if (pErr) throw pErr;
        return json({ id: c.user.id, email });
      }
      case "set_password": {
        if (!payload.id || !payload.password) return json({ error: "id og passord er påkrevd" }, 400);
        const { error } = await admin.auth.admin.updateUserById(payload.id, { password: payload.password });
        if (error) throw error;
        return json({ ok: true });
      }
      case "update": {
        if (!payload.id) return json({ error: "id er påkrevd" }, 400);
        const upd: Record<string, unknown> = {};
        if (payload.role !== undefined) upd.role = payload.role;
        if (payload.ra !== undefined) upd.ra = payload.ra;
        if (payload.full_name !== undefined) upd.full_name = payload.full_name;
        const { error } = await admin.from("profiles").update(upd).eq("id", payload.id);
        if (error) throw error;
        return json({ ok: true });
      }
      case "set_active": {
        if (!payload.id || typeof payload.aktiv !== "boolean") return json({ error: "id og aktiv (boolean) er påkrevd" }, 400);
        const { error: pErr } = await admin.from("profiles").update({ aktiv: payload.aktiv }).eq("id", payload.id);
        if (pErr) throw pErr;
        const { error: aErr } = await admin.auth.admin.updateUserById(payload.id, {
          ban_duration: payload.aktiv ? "none" : "876000h",
        });
        if (aErr) throw aErr;
        return json({ ok: true });
      }
      case "delete": {
        if (!payload.id) return json({ error: "id er påkrevd" }, 400);
        if (payload.id === u.user.id) return json({ error: "Du kan ikke slette din egen bruker" }, 400);
        const { error } = await admin.auth.admin.deleteUser(payload.id);
        if (error) throw error;
        return json({ ok: true });
      }
      default:
        return json({ error: "Ukjent action" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
