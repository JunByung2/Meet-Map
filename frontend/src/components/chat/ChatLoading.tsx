import styles from './chat.module.css'

export function ChatLoadingMessages() {
  return (
    <div className={styles.loadingMessages} role="status">
      <span>대화를 불러오고 있어요.</span>
      <div className={styles.loadingBubbles} aria-hidden="true">
        <i /><i /><i />
      </div>
    </div>
  )
}

export default function ChatLoading() {
  return (
    <div className={styles.loadingShell} aria-busy="true">
      <div className={styles.loadingHeading} aria-hidden="true"><i /><i /></div>
      <div className={styles.loadingMain}><ChatLoadingMessages /></div>
      <div className={styles.loadingComposer} aria-hidden="true"><i /><i /><i /></div>
    </div>
  )
}
