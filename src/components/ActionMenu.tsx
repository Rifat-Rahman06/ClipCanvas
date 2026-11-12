import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { classNames } from '../lib/utils';
import { IconButton } from './Button';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

interface ActionMenuProps {
  items: MenuItem[];
  label: string;
  size?: 'sm' | 'md';
  align?: 'left' | 'right';
  trigger?: React.ReactNode;
}

interface Position {
  top: number;
  left: number;
}

export function ActionMenu({
  items,
  label,
  size = 'sm',
  align = 'right',
  trigger,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const focusFirst = window.setTimeout(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    }, 20);

    const close = () => setOpen(false);
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const handleScroll = () => close();
    document.addEventListener('pointerdown', handlePointer);
    window.addEventListener('resize', handleScroll);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.clearTimeout(focusFirst);
      document.removeEventListener('pointerdown', handlePointer);
      window.removeEventListener('resize', handleScroll);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 208;
    const estimatedHeight = Math.min(items.length * 38 + 16, 300);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow < estimatedHeight + 12 && rect.top > estimatedHeight + 12
        ? rect.top - estimatedHeight - 6
        : rect.bottom + 6;
    const left =
      align === 'right'
        ? Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
        : Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPosition({ top, left });
    setOpen(true);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
        []),
    ];
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? buttons[(index + 1) % buttons.length]
        : buttons[(index - 1 + buttons.length) % buttons.length];
    next.focus();
  };

  return (
    <span className="menu-anchor" ref={triggerRef}>
      <IconButton
        label={label}
        size={size}
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={classNames(open && 'is-active')}
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </IconButton>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="action-menu"
              role="menu"
              aria-label={label}
              style={{ top: position.top, left: position.left }}
              onKeyDown={handleMenuKeyDown}
            >
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label}>
                    {item.separatorBefore ? <div className="menu-separator" /> : null}
                    <button
                      type="button"
                      role="menuitem"
                      className={classNames('menu-item', item.danger && 'menu-item-danger')}
                      disabled={item.disabled}
                      onClick={() => {
                        setOpen(false);
                        item.onSelect();
                      }}
                    >
                      {Icon ? <Icon size={15} aria-hidden="true" /> : <span className="menu-icon-spacer" />}
                      <span>{item.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
