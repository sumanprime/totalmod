import { openPreview } from "@/lib/open-preview";

export function GET(request: Request) {
  return openPreview(request, 0);
}
