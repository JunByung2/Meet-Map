"use client";

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './chat.module.css'

export default function MobileMeetDialog({ open, onClose, children }: {
  open: boolean; onClose: () => void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])
  useEffect(() => {
    const dialog = ref.current
    const viewport = window.visualViewport
    if (!dialog) return
    const fit = () => {
      dialog.style.setProperty('--sheet-height', `${viewport?.height ?? window.innerHeight}px`)
      dialog.style.setProperty('--sheet-top', `${viewport?.offsetTop ?? 0}px`)
    }
    fit()
    viewport?.addEventListener('resize', fit)
    viewport?.addEventListener('scroll', fit)
    return () => {
      viewport?.removeEventListener('resize', fit)
      viewport?.removeEventListener('scroll', fit)
    }
  }, [])
  return createPortal(
    <dialog ref={ref} className={styles.meetDialog} aria-labelledby="mobile-meet-title"
      onCancel={onClose} onClose={onClose}>
      <div className={styles.meetDialogHeader}>
        <h2 id="mobile-meet-title">MeetMode</h2>
        <button type="button" className="btn secondary sm" onClick={onClose} autoFocus>닫기</button>
      </div>
      <div className={styles.meetDialogBody}>{children}</div>
    </dialog>, document.body,
  )
}
