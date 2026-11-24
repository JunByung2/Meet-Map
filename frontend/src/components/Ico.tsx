// 색깔 이모지 대신 쓰는 선 아이콘. 색은 주변 글자색(currentColor)을 따라가서 갈색 톤에 맞는다.
const P: Record<string, string> = {
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  cal: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  chat: "M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z",
  image: "M4 5h16v14H4zM4 17l5-5 4 4 3-3 4 4M9 10.5a1 1 0 1 0 0-.01",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  trophy:
    "M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4M8 21h8M10 17h4",
  vote: "M3 13h18v7H3zM8 13l1-4h6l1 4M9 16.5h6",
  trash: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v6M14 11v6",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  copy: "M9 9h11v11H9zM5 15V4h11",
  arrow: "M5 12h14M13 6l6 6-6 6",
  hourglass: "M7 3h10M7 21h10M8 3v3l4 5-4 5v3M16 3v3l-4 5 4 5v3",
  tool: "M14 6a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 1-2-2z",
  check: "M5 12l5 5 9-10",
  leaf: "M5 19c0-9 5-14 14-14 0 9-5 14-14 14zM5 19l8-8",
  sel: "M4 4h16v16H4zM8 12l3 3 5-6",
  down: "M12 4v12M6 11l6 6 6-6M5 20h14",
};

export type IcoName = keyof typeof P;

export default function Ico({
  n,
  size = "1em",
}: {
  n: IcoName;
  size?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ verticalAlign: "-0.15em", flexShrink: 0 }}
    >
      <path d={P[n]} />
    </svg>
  );
}
