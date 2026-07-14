import { ActionFeedbackDialog } from './ActionFeedbackDialog';

export function SuccessToast({ message, onClose }: { message: string | null; onClose: () => void }) {
  return <ActionFeedbackDialog message={message ?? ''} onClose={onClose} open={Boolean(message)} title="操作成功" tone="success" />;
}
