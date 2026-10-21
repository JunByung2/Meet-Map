'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import PlacePicker from '@/components/PlacePicker'
import PhotoShell from '@/components/PhotoShell'
import { api } from '@/lib/api'
import {
  formatDate,
  formatDateTime,
  placeOf,
  type Photo,
  type PhotoDetail,
  type PlaceValue,
} from '@/lib/photos'

/**
 * 사진 주소는 다른 사이트(Supabase 저장소)에 있어서 <a download> 만으로는 브라우저가 저장하지 않고 그냥 열어 버려요.
 * 그래서 우리 서버(/api/groups/{그룹}/photos/{사진}/download)가 사진을 대신 받아 "첨부 파일"로 내려 주고,
 * 여기서는 그 응답을 파일로 저장해요. (이동 없이 바로 저장 / 실패하면 화면에 이유를 보여줘요)
 */
function DownloadButton({ groupId, photo }: { groupId: string; photo: Photo }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ext = photo.storage_path.split('.').pop()?.toLowerCase() ?? 'jpg'

  async function download() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(
        `/api/groups/${groupId}/photos/${photo.id}/download`,
        { credentials: 'same-origin' },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          typeof data?.detail === 'string'
            ? data.detail
            : '사진을 내려받지 못했어요.',
        )
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `meetmap-photo-${photo.id}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진을 내려받지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 6,
      }}
    >
      <button
        type="button"
        className="btn secondary"
        onClick={download}
        disabled={busy}
      >
        {busy ? '내려받는 중…' : '사진 다운로드'}
      </button>
      {error && (
        <span className="error" role="alert" style={{ fontSize: 12 }}>
          {error}
        </span>
      )}
    </div>
  )
}

export default function PhotoDetailPage() {
  return (
    <PhotoShell>
      {({ groupId, onApiError }) => (
        <Detail groupId={groupId} onApiError={onApiError} />
      )}
    </PhotoShell>
  )
}

function Detail({
  groupId,
  onApiError,
}: {
  groupId: string
  onApiError: (e: unknown) => string
}) {
  const { photoId } = useParams<{ photoId: string }>()
  const [batch, setBatch] = useState<Photo[]>([])
  const [activeId, setActiveId] = useState<number>(Number(photoId))
  const [title, setTitle] = useState('')
  const [memo, setMemo] = useState('')
  const [caption, setCaption] = useState('')
  const [place, setPlace] = useState<PlaceValue | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api<PhotoDetail>(`/groups/${groupId}/photos/${photoId}`)
      setBatch(d.batch)
      setActiveId(d.photo.id)
      setCaption(d.photo.caption || '')
      setTitle(d.batch.find((p) => p.title?.trim())?.title || '')
      setMemo(d.batch.find((p) => p.memo?.trim())?.memo || '')
      setPlace(d.batch.map(placeOf).find((x) => x !== null) ?? null)
    } catch (e) {
      setError(onApiError(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, photoId])

  useEffect(() => {
    load()
  }, [load])

  const index = Math.max(
    0,
    batch.findIndex((p) => p.id === activeId),
  )
  const photo = batch[index] ?? null
  const prev = index > 0 ? batch[index - 1] : null
  const next = index < batch.length - 1 ? batch[index + 1] : null
  const canEdit = !!photo?.can_edit
  const back = `/groups/${groupId}/photos`

  function select(p: Photo) {
    setActiveId(p.id)
    setCaption(p.caption || '')
    setError('')
    setMessage('')
  }

  async function saveCaption() {
    if (!photo) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const updated = await api<Photo>(
        `/groups/${groupId}/photos/${photo.id}`,
        { method: 'PATCH', body: { caption } },
      )
      setBatch((cur) =>
        cur.map((p) =>
          p.id === updated.id ? { ...p, caption: updated.caption } : p,
        ),
      )
      setMessage('사진 설명을 저장했어요.')
    } catch (e) {
      setError(onApiError(e))
    } finally {
      setBusy(false)
    }
  }

  // 제목·메모는 같은 묶음의 모든 사진에 똑같이 저장돼요
  async function saveRecord() {
    if (!photo) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const updated = await api<Photo[]>(
        `/groups/${groupId}/photos/batch/${photo.batch_id}`,
        {
          method: 'PATCH',
          body: {
            title,
            memo,
            place: place
              ? {
                  id: place.id,
                  name: place.name,
                  address: place.address,
                  lat: place.lat,
                  lng: place.lng,
                }
              : null,
          },
        },
      )
      setBatch((cur) =>
        cur.map((p) => ({
          ...p,
          title: updated[0]?.title ?? null,
          memo: updated[0]?.memo ?? null,
          place_id: updated[0]?.place_id ?? null,
          place_name: updated[0]?.place_name ?? null,
          place_address: updated[0]?.place_address ?? null,
          place_lat: updated[0]?.place_lat ?? null,
          place_lng: updated[0]?.place_lng ?? null,
        })),
      )
      setMessage('제목과 메모를 저장했어요.')
    } catch (e) {
      setError(onApiError(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return <div className="card muted">사진을 불러오는 중이에요.</div>
  if (!photo)
    return (
      <>
        <div className="error">{error || '사진을 찾지 못했어요.'}</div>
        <Link href={back} className="link-arrow">
          ← 사진 모음으로
        </Link>
      </>
    )

  const savedTitle = batch.find((p) => p.title?.trim())?.title?.trim()
  const savedMemo = batch.find((p) => p.memo?.trim())?.memo?.trim()
  const heading = savedTitle || photo.caption?.trim() || '이 순간을 기억해요'
  const ext = photo.storage_path.split('.').pop()?.toUpperCase()

  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href={back} className="link-arrow">
          ← 그룹 사진으로 돌아가기
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {batch.length > 1
              ? `함께 올린 ${batch.length}장의 순간`
              : '한 장의 순간'}
          </p>
          <h1 className="page-title">{heading}</h1>
          <p className="page-sub">
            {savedMemo ||
              `${formatDate(photo.created_at)} · ${photo.uploader_nickname ?? '알 수 없음'}이(가) 올린 사진`}
          </p>
        </div>
        {photo.signed_url && <DownloadButton groupId={groupId} photo={photo} />}
      </div>

      <div className="ph-detail">
        <div>
          <div className="ph-viewer">
            {photo.signed_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.signed_url}
                alt={photo.caption || '업로드한 사진'}
              />
            )}
            {prev && (
              <button
                type="button"
                className="ph-arrow left"
                onClick={() => select(prev)}
                aria-label="이전 사진"
              >
                ‹
              </button>
            )}
            {next && (
              <button
                type="button"
                className="ph-arrow right"
                onClick={() => select(next)}
                aria-label="다음 사진"
              >
                ›
              </button>
            )}
            {batch.length > 1 && (
              <span className="ph-pos">
                {index + 1} / {batch.length}
              </span>
            )}
          </div>
          {batch.length > 1 && (
            <div className="ph-thumbs">
              {batch.map((p, i) => (
                <button
                  type="button"
                  key={p.id}
                  className={p.id === photo.id ? 'ph-thumb active' : 'ph-thumb'}
                  onClick={() => select(p)}
                  aria-label={`${i + 1}번째 사진 보기`}
                >
                  {p.signed_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.signed_url}
                      alt={p.caption || `${i + 1}번째 사진`}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="ph-side">
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 14 }}>
              이 순간의 기록
            </h2>
            <div className="field">
              <label htmlFor="d-title">사진 제목</label>
              <input
                id="d-title"
                className="input"
                value={title}
                maxLength={60}
                disabled={!canEdit}
                placeholder="예. 서울숲에서 보낸 오후"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="d-memo">한마디 메모</label>
              <textarea
                id="d-memo"
                className="ph-textarea"
                value={memo}
                maxLength={500}
                disabled={!canEdit}
                placeholder="이 순간에 대한 한마디"
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              {canEdit ? (
                <PlacePicker value={place} onChange={setPlace} />
              ) : place ? (
                <p className="meta">
                  📍 {place.name}
                  {place.address ? ` · ${place.address}` : ''}
                </p>
              ) : null}
            </div>
            {canEdit ? (
              <div className="row-between">
                <span className="meta">
                  {batch.length > 1
                    ? `묶음 ${batch.length}장에 함께 저장돼요`
                    : `${memo.length} / 500자`}
                </span>
                <button className="btn sm" onClick={saveRecord} disabled={busy}>
                  기록 저장
                </button>
              </div>
            ) : (
              <p className="meta">올린 사람이나 방장만 수정할 수 있어요.</p>
            )}
          </section>

          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 14 }}>
              {batch.length > 1 ? `${index + 1}번째 사진 설명` : '사진 설명'}
            </h2>
            <textarea
              className="ph-textarea"
              aria-label="사진 설명"
              value={caption}
              maxLength={200}
              disabled={!canEdit}
              placeholder="이 사진에 남기고 싶은 이야기"
              onChange={(e) => setCaption(e.target.value)}
            />
            {canEdit && (
              <div className="row-between" style={{ marginTop: 10 }}>
                <span className="meta">{caption.length} / 200자</span>
                <button
                  className="btn sm"
                  onClick={saveCaption}
                  disabled={busy}
                >
                  설명 저장
                </button>
              </div>
            )}
            {error && (
              <div className="error" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
            {message && (
              <p className="ph-ok" style={{ marginTop: 12, marginBottom: 0 }}>
                {message}
              </p>
            )}
          </section>

          <section className="card">
            <strong>{photo.uploader_nickname ?? '알 수 없음'}</strong>
            <span className="meta">
              {' '}
              · {formatDateTime(photo.created_at)} 업로드
            </span>
            {place && (
              <p style={{ marginTop: 10 }}>
                <Link
                  className="link-arrow"
                  href={`/groups/${groupId}/map?batch=${photo.batch_id}`}
                >
                  지도에서 이 장소 보기 →
                </Link>
              </p>
            )}
            <dl className="ph-info">
              <dt>함께 올린 사진</dt>
              <dd>{batch.length}장</dd>
              <dt>정렬 순서</dt>
              <dd>{photo.sort_order}</dd>
              <dt>원본</dt>
              <dd>
                {ext} · {photo.storage_path}
              </dd>
            </dl>
          </section>
        </aside>
      </div>
    </>
  )
}
