import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
const isDev = process.env.NODE_ENV !== "production";

// 화면에서 불러올 수 있는 곳을 제한해 XSS 같은 공격의 피해를 줄인다.
// 카카오 지도 SDK 가 쓰는 주소는 허용한다. 지도가 안 뜨면 브라우저 콘솔의 CSP 오류를 보고 여기에 주소를 더한다.
// CSP_MODE=report 로 실행하면 막지 않고 콘솔에 경고만 남긴다.
const KAKAO =
  "https://*.kakao.com https://*.daumcdn.net https://*.kakaocdn.net";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${KAKAO}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${KAKAO}${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  {
    key:
      process.env.CSP_MODE === "report"
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy",
    value: csp,
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 위치 공유(Meet Mode)에 쓰는 위치 정보만 이 사이트에서 허용한다
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(), microphone=(), payment=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]),
];

const nextConfig: NextConfig = {
  // 서버 종류를 알려 주는 X-Powered-By 헤더를 숨긴다
  poweredByHeader: false,
  // 로컬 장거리 추천이 여러 멤버의 경로를 조회하는 동안 연결을 유지한다.
  experimental: { proxyTimeout: 180_000 },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
