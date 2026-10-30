import { getCatalog } from "@/lib/catalog";
export async function GET() {
  return Response.json(getCatalog(), {
    headers: { "Cache-Control": "no-store" },
  });
}
