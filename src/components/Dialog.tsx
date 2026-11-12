import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { classNames } from '../lib/utils';
import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  closeOnBackdrop?: boolean;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
  busy = false,
  closeOnBackdrop = true,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dialog-title-${Math.random().toString(36).slice(2)}`).current;
  const descriptionId = useRef(`dialog-desc-${Math.random().toString(36).slice(2)}`).current;
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const preferred = dialog.querySelector<HTMLElement>('[data-autofocus]');
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
      (preferred ?? first ?? dialog).focus();
    }, 30);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const previous = previousFocus.current;
      if (previous && document.contains(previous)) {
        window.setTimeout(() => previous.focus(), 0);
      }
    };
  }, [open]);

  if (!open) return null;

  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (!busy && closeOnBackdrop && event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={handleBackdrop}>
      <div
        ref={dialogRef}
        className={classNames('dialog', `dialog-${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="dialog-head">
          <div className="dialog-heading">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="dialog-description">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close dialog" onClick={onClose} disabled={busy}>
            <X size={17} />
          </IconButton>
        </header>
        {children !== null && children !== undefined ? (
          <div className="dialog-body">{children}</div>
        ) : null}
        {footer ? <footer className="dialog-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  children?: ReactNode;
  confirmDisabled?: boolean;
  tone?: 'danger' | 'primary';
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  busy = false,
  children,
  confirmDisabled = false,
  tone = 'danger',
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      busy={busy}
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary btn-md"
            onClick={onClose}
            disabled={busy}
            data-autofocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={classNames('btn', `btn-${tone === 'danger' ? 'danger' : 'primary'}`, 'btn-md')}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            aria-busy={busy || undefined}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

export function useDialogOpen(initiallyOpen = false) {
  const [open, setOpen] = useState(initiallyOpen);
  return { open, setOpen, show: () => setOpen(true), hide: () => setOpen(false) };
}

export type { DialogProps, ConfirmDialogProps, RefObject };
