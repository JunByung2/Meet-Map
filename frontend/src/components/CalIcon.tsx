/**
 * 달력 아이콘. 📅 이모지는 폰마다 모양이 달라서(안드로이드는 날짜 "17" 이 적힘) 모든 기기에서 똑같이 보이도록 그림으로 그렸다.
 */
export default function CalIcon({ size = "1em" }: { size?: string | number }) {
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
      style={{ verticalAlign: "-0.14em", flex: "none" }}
    >
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}
