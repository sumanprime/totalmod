// The scripted demo's try-it link for a fix round: /round/<n>/totalmod/preview?token=…
// (see previewDeployed in lib/scripted-demo.ts), so the preview shows the latest round's build.
import { parseRound } from "@/lib/demo-feature";
import { openPreview } from "@/lib/open-preview";

export async function GET(
  request: Request,
  { params }: RouteContext<"/round/[round]/totalmod/preview">,
) {
  return openPreview(request, parseRound((await params).round));
}
