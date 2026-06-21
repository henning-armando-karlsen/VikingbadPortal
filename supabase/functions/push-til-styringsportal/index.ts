import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_URL = Deno.env.get("STYRINGSPORTAL_INGEST_URL")!;
const INGEST_SECRET = Deno.env.get("STYRINGSPORTAL_INGEST_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const sb = createClient(SB_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Bygg e-postoppslag fra profiles (case-insensitivt på full_name)
    const { data: profiles } = await sb.from("profiles").select("full_name, email");
    const emailByName: Record<string, string> = {};
    for (const p of (profiles ?? [])) {
      if (p.full_name) emailByName[p.full_name.toLowerCase()] = p.email ?? null;
    }
    const findEmail = (ra: string | null): string | null =>
      ra ? (emailByName[ra.toLowerCase()] ?? null) : null;

    const items: unknown[] = [];

    // a) Åpne oppgaver
    const { data: tasks } = await sb
      .from("crm_tasks")
      .select("id, tittel, ra, frist, kundenr, prioritet")
      .eq("status", "apen");
    for (const t of (tasks ?? [])) {
      if (!t.ra) continue;
      items.push({
        external_id: `task:${t.id}`,
        kind: "oppgave",
        title: t.tittel,
        assignee_name: t.ra,
        assignee_email: findEmail(t.ra),
        status: "apen",
        due: t.frist,
        kunde: t.kundenr ? `Kunde ${t.kundenr}` : null,
        prioritet: t.prioritet,
        kilde: "crm",
      });
    }

    // b) Aktive pipeline-muligheter (ikke vunnet/tapt)
    const { data: pipeline } = await sb
      .from("crm_pipeline")
      .select("id, tittel, ra, stage, verdi, sannsynlighet, kundenr")
      .neq("stage", "vunnet")
      .neq("stage", "tapt");
    for (const p of (pipeline ?? [])) {
      if (!p.ra) continue;
      items.push({
        external_id: `pipe:${p.id}`,
        kind: "pipeline",
        title: p.tittel,
        assignee_name: p.ra,
        assignee_email: findEmail(p.ra),
        status: p.stage,
        stage: p.stage,
        verdi: p.verdi,
        sannsynlighet: p.sannsynlighet,
        kunde: p.kundenr ? `Kunde ${p.kundenr}` : null,
        kilde: "crm",
      });
    }

    // c) Besøk med neste_steg satt, eller dato >= i dag
    const today = new Date().toISOString().slice(0, 10);
    const { data: visits } = await sb
      .from("crm_visits")
      .select("id, tittel, ra, type, neste_steg, dato, kundenr")
      .or(`neste_steg.not.is.null,dato.gte.${today}`);
    for (const v of (visits ?? [])) {
      if (!v.ra) continue;
      items.push({
        external_id: `visit:${v.id}`,
        kind: "besok",
        title: v.tittel,
        assignee_name: v.ra,
        assignee_email: findEmail(v.ra),
        type: v.type,
        neste_steg: v.neste_steg,
        due: v.dato,
        kunde: v.kundenr ? `Kunde ${v.kundenr}` : null,
        kilde: "crm",
      });
    }

    // Send samlet til styringsportalen
    const resp = await fetch(INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ingest-secret": INGEST_SECRET,
      },
      body: JSON.stringify({ items }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json(
        { error: `Ingest feilet (${resp.status}): ${errText.slice(0, 300)}` },
        502,
      );
    }

    return json({ ok: true, count: items.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
