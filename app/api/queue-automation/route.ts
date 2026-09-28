import { env } from "cloudflare:workers";
import { requeueNoShows } from "@/lib/charging-queue";
import { getDatabase } from "@/lib/database";

function sameValue(first: string, second: string) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

export async function POST(request: Request) {
  const token = env.QUEUE_AUTOMATION_TOKEN;
  const authorization = request.headers.get("authorization") || "";
  const expected = token ? `Bearer ${token}` : "";
  if (!token || !sameValue(authorization, expected)) return new Response(null, { status: 404 });

  try {
    const requeued = await requeueNoShows(getDatabase());
    return Response.json({ requeued }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("No fue posible procesar las ausencias de la fila.", cause);
    return Response.json({ error: "No fue posible actualizar la fila." }, { status: 503 });
  }
}
