import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname !== "/v2") {
    return NextResponse.next();
  }

  const preview = searchParams.get("preview");
  const lang = searchParams.get("lang");
  const url = request.nextUrl.clone();
  url.pathname = preview === "1" ? "/demo" : "/";

  const nextSearch = new URLSearchParams();
  if (lang === "zh" || lang === "en") {
    nextSearch.set("lang", lang);
  }
  url.search = nextSearch.toString() ? `?${nextSearch.toString()}` : "";

  return NextResponse.redirect(url);
}

export const config = {
  matcher: "/v2",
};
