// 카카오 지도 SDK 불러오기 + 장소 검색 (지도 담당 종은 코드 기반, 여러 컴포넌트가 하나의 SDK를 같이 쓰도록 정리)
//
// 필요한 설정: frontend/.env.local 에  NEXT_PUBLIC_KAKAO_JS_KEY=발급받은_JavaScript_키
// 카카오 개발자 콘솔 > 앱 > 플랫폼 > Web 에 http://localhost:3000 이 등록되어 있어야 해요.

declare global {
  interface Window {
    // 카카오 SDK 객체 (타입 패키지 없이 쓰기 위해 any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kakao: any;
  }
}

/** 지도/장소 검색 결과를 우리 앱에서 쓰는 모양으로 통일한 것 */
export type PlaceResult = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkPromise: Promise<any> | null = null;

/** SDK(지도 + 장소 검색 services)를 한 번만 불러오고, 준비되면 window.kakao 를 돌려준다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadKakao(): Promise<any> {
  if (typeof window === "undefined")
    return Promise.reject(new Error("브라우저에서만 쓸 수 있어요."));
  if (sdkPromise) return sdkPromise;

  const appKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
  if (!appKey) {
    return Promise.reject(
      new Error(
        "카카오 JavaScript 키가 설정되지 않았어요. frontend/.env.local 에 NEXT_PUBLIC_KAKAO_JS_KEY 를 넣고 npm run dev 를 다시 실행해 주세요.",
      ),
    );
  }

  sdkPromise = new Promise((resolve, reject) => {
    const ready = () => window.kakao.maps.load(() => resolve(window.kakao));
    if (window.kakao?.maps) {
      ready();
      return;
    }
    const script = document.createElement("script");
    script.id = "kakao-map-sdk";
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false&libraries=services`;
    script.async = true;
    script.onload = ready;
    script.onerror = () => {
      sdkPromise = null; // 다음에 다시 시도할 수 있게
      script.remove();
      reject(
        new Error(
          "카카오 지도를 불러오지 못했어요. JavaScript 키와 허용 도메인(http://localhost:3000)을 확인해 주세요.",
        ),
      );
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** 키워드로 장소 검색 (카카오 Local). 결과가 없으면 빈 배열. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function searchKeyword(
  kakao: any,
  keyword: string,
): Promise<PlaceResult[]> {
  return new Promise((resolve, reject) => {
    const service = new kakao.maps.services.Places();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service.keywordSearch(keyword, (data: any[], status: string) => {
      if (status === kakao.maps.services.Status.OK) {
        resolve(
          data.map((d) => ({
            id: String(d.id),
            name: d.place_name,
            address: d.road_address_name || d.address_name || "",
            lat: Number(d.y), // y = 위도
            lng: Number(d.x), // x = 경도
          })),
        );
      } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
        resolve([]);
      } else {
        reject(new Error("장소 검색 중 오류가 발생했어요."));
      }
    });
  });
}
