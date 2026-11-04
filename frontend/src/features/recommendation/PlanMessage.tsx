import Link from 'next/link'

// 이 그룹의 내부 추천 링크만 버튼으로 표시. 일반 텍스트는 그대로 렌더링한다.
export default function PlanMessage({ text, groupId }: { text: string; groupId: number }) {
  const lines = text.split('\n')
  const last = lines[lines.length - 1]
  const match = /^\/recommend\?groupId=([1-9]\d*)&planId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(last)
  if (!match || Number(match[1]) !== Number(groupId)) return <>{text}</>
  return <>
    {lines.slice(0, -1).join('\n')}
    <div style={{ marginTop: 10 }}>
      <Link href={last} style={{ textDecoration: 'underline', fontWeight: 700 }}>
        약속 장소 정하기 →
      </Link>
    </div>
  </>
}
