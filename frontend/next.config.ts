import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // 로컬 장거리 추천이 여러 멤버의 경로를 조회하는 동안 연결을 유지한다.
  experimental: { proxyTimeout: 180_000 },
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
