import { toast } from 'sonner';

export type NotifyKind = 'success' | 'info' | 'warning' | 'error';

export type Notify = Readonly<Record<NotifyKind, (message: string) => void>>;

export const notify: Notify = Object.freeze({
  success: (message: string): void => {
    toast.success(message);
  },
  info: (message: string): void => {
    toast.info(message);
  },
  warning: (message: string): void => {
    toast.warning(message);
  },
  error: (message: string): void => {
    toast.error(message);
  },
});
