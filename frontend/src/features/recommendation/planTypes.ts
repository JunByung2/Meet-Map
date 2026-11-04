export interface SavedDeparture {
  place_id: string
  name: string
  address: string
  latitude: number
  longitude: number
}

export interface PlanState {
  id: string
  group_id: number
  group_name: string
  me: { id: number; nickname: string }
  snapshot: string
  members: {
    user_id: number
    nickname: string
    ready: boolean
    departure: SavedDeparture | null
  }[]
  own_departure: SavedDeparture | null
  can_recommend: boolean
  result: {
    generated_at: string
    ranking_rule: string
    member_ids: number[]
    excluded_count: number
    recommendations: {
      id: string; name: string; address: string
      latitude: number; longitude: number
      average: number; maximum: number; member_minutes: number[]
    }[]
  } | null
}
