export interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

interface Props {
  toasts: Toast[]
}

export function ToastContainer({ toasts }: Props) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
