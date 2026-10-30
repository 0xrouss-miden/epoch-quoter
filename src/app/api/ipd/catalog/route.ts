import { asIpdError, solverService } from "@/lib/ipd/service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const service = solverService();
    return Response.json(
      {
        catalog: await service.catalog(request.signal),
        settings: service.settings,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const failure = asIpdError(error);
    return Response.json(
      {
        error: failure.message,
        status: failure.status,
        retryAt: failure.retryAt,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
