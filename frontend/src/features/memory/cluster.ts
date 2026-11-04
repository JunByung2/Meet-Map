// 추억지도 사진 마커 묶기 (아이폰 사진 앱의 지도처럼, 가까이 있는 사진은 하나로 합쳐 보여줘요)
// 카카오 SDK를 쓰지 않는 순수 계산이라 따로 떼어 두었어요.

export type PinLike = {
  id: string
  latitude: number
  longitude: number
  /** 이 장소의 사진 장수 */
  count: number
  /** 가장 최근 추억의 시각(ms). 묶음의 대표 사진을 고를 때 써요 */
  time: number
}

export type Cluster<T extends PinLike> = {
  /** 묶음 구성원이 같으면 같은 key (화면을 다시 그릴 때 그대로 재사용) */
  key: string
  members: T[]
  /** 대표(가장 최근) 장소 */
  cover: T
  /** 묶음 안 사진 장수의 합 */
  count: number
  latitude: number
  longitude: number
}

type Project = (latitude: number, longitude: number) => { x: number; y: number }

/**
 * 화면(px) 위에서 가까운 장소끼리 묶어요.
 * - 가장 최근 장소부터 기준으로 잡고, 반경(radius px) 안에 있는 아직 안 묶인 장소를 모두 흡수해요.
 * - 장소 하나뿐인 묶음은 실제 좌표 그대로, 여러 장소면 사진 장수를 가중치로 한 중심에 둬요.
 */
export function clusterPins<T extends PinLike>(
  pins: T[],
  project: Project,
  radius: number,
): Cluster<T>[] {
  const sorted = [...pins].sort(
    (a, b) => b.time - a.time || a.id.localeCompare(b.id),
  )
  const point = new Map(
    sorted.map((p) => [p.id, project(p.latitude, p.longitude)]),
  )
  const used = new Set<string>()
  const out: Cluster<T>[] = []

  for (const anchor of sorted) {
    if (used.has(anchor.id)) continue
    used.add(anchor.id)
    const a = point.get(anchor.id)!
    const members: T[] = [anchor]
    for (const other of sorted) {
      if (used.has(other.id)) continue
      const b = point.get(other.id)!
      if (Math.hypot(a.x - b.x, a.y - b.y) <= radius) {
        used.add(other.id)
        members.push(other)
      }
    }

    const count = members.reduce((n, m) => n + m.count, 0)
    let latitude = anchor.latitude
    let longitude = anchor.longitude
    if (members.length > 1) {
      const weight = members.reduce((n, m) => n + Math.max(m.count, 1), 0)
      latitude =
        members.reduce((n, m) => n + m.latitude * Math.max(m.count, 1), 0) /
        weight
      longitude =
        members.reduce((n, m) => n + m.longitude * Math.max(m.count, 1), 0) /
        weight
    }
    out.push({
      key: members
        .map((m) => m.id)
        .sort()
        .join('|'),
      members,
      cover: anchor,
      count,
      latitude,
      longitude,
    })
  }
  return out
}
