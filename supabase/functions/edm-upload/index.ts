import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

async function ensureBucket() {
  await fetch(`${SB_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "edm", name: "edm", public: true }),
  }).catch(() => {});
  await fetch(`${SB_URL}/storage/v1/bucket/edm`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ public: true }),
  }).catch(() => {});
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    const u = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: auth },
    });
    if (!u.ok) return json({ error: "Ikke innlogget" }, 401);

    const { filename = "bilde", contentType = "application/octet-stream", data } = await req.json();
    if (!data) return json({ error: "data (base64) mangler" }, 400);
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: "Ugyldig base64" }, 400);
    }
    if (bytes.length > 6 * 1024 * 1024) return json({ error: "Filen er for stor (maks 6 MB)" }, 400);

    await ensureBucket();
    const safe =
      String(filename).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
      "bilde";
    const path = `${Date.now()}-${safe}`;
    const up = await fetch(`${SB_URL}/storage/v1/object/edm/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: bytes,
    });
    if (!up.ok) return json({ error: `Storage (${up.status}): ${await up.text()}` }, 500);

    return json({ url: `${SB_URL}/storage/v1/object/public/edm/${path}` });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
