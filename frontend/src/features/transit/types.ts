export interface Place {
  id: string
  name: string
  address: string
  latitude: number
  longitude: number
}

export interface TransitStep {
  mode: string
  guidance: string
  seconds: number | null
  distance: number | null
  stops: string[]
  vehicles: string[]
  points: [number, number][]
}

export interface TransitRoute {
  id: string
  mode: string
  seconds: number
  distance: number | null
  transfers: number | null
  fare: number | null
  fare_min: number | null
  fare_max: number | null
  steps: TransitStep[]
}
