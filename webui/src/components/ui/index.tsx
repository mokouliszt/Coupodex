import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------- Button ---------- */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[transform,background-color,opacity] active:scale-[.97] disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        default: "bg-orange text-white font-semibold",
        amber: "bg-amber text-ink font-semibold",
        outline: "border border-line text-ink bg-transparent",
        ghost: "text-[var(--muted)]",
        solid: "bg-ink text-white font-semibold",
        danger: "bg-transparent border border-danger/50 text-danger",
      },
      size: {
        default: "h-11 px-4",
        sm: "h-9 px-3 text-[13px]",
        lg: "h-14 px-6 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";

/* ---------- Input / Textarea / Label ---------- */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-xl bg-card px-3.5 text-[15px] text-ink outline-none",
        "border border-line placeholder:text-[rgba(233,250,252,.35)]",
        "focus:border-orange/60 transition-colors",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-xl bg-card px-3.5 py-3 text-[15px] leading-relaxed text-ink outline-none",
        "border border-line placeholder:text-[rgba(233,250,252,.35)] resize-none",
        "focus:border-orange/60 transition-colors",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn("eyebrow text-orange/70", className)} {...props} />
));
Label.displayName = "Label";

/* ---------- Badge ---------- */

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "orange" | "amber" | "danger" | "ink" }) {
  const tones = {
    neutral: "bg-ink/[.06] text-ink/70",
    orange: "bg-orange/10 text-orange",
    amber: "bg-amber/20 text-[#8a5a00]",
    danger: "bg-danger/12 text-danger",
    ink: "bg-orange/10 text-orange",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Sheet（下から出るモーダル） ---------- */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { full?: boolean; title?: string }
>(({ className, children, full, title, style, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-[rise_.2s_ease]" />
    <DialogPrimitive.Content
      ref={ref}
      // キーボードが被さる分(--kbh)だけ底上げして、入力欄が隠れないようにする
      style={{
        bottom: "var(--kbh, 0px)",
        ...(full ? { top: 0 } : { maxHeight: "calc(var(--vh, 100vh) * 0.92)" }),
        ...style,
      }}
      className={cn(
        "fixed inset-x-0 z-50 flex flex-col rounded-t-[22px] bg-card",
        "border-t border-line shadow-[0_-16px_50px_rgba(43,22,8,.16)] outline-none",
        "data-[state=open]:animate-[pop_.26s_cubic-bezier(.2,.8,.2,1)]",
        full && "rounded-none",
        className,
      )}
      {...props}
    >
      <DialogPrimitive.Title className="sr-only">{title || "詳細"}</DialogPrimitive.Title>
      {!full && (
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-ink/20" aria-hidden />
      )}
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

export function SheetHeader({ title, eyebrow, onClose }: { title: string; eyebrow?: string; onClose?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1 text-orange/60">{eyebrow}</div>}
        <h2 className="truncate text-[19px] font-semibold tracking-tight">{title}</h2>
      </div>
      <SheetClose asChild>
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink/[.05] text-[var(--muted)]"
        >
          <X size={17} />
        </button>
      </SheetClose>
    </div>
  );
}

/* ---------- Select ---------- */

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-line",
      "bg-card px-3.5 text-[14px] outline-none data-[placeholder]:text-[var(--muted)]",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown size={15} className="opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position="popper"
      sideOffset={6}
      className={cn(
        "z-[60] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl",
        "border border-line bg-card shadow-2xl",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-lg py-2.5 pl-3 pr-8 text-[14px] outline-none",
      "data-[highlighted]:bg-orange/10",
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <span className="absolute right-2.5 grid place-items-center">
      <SelectPrimitive.ItemIndicator>
        <Check size={14} className="text-orange" />
      </SelectPrimitive.ItemIndicator>
    </span>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";

/* ---------- Chip ---------- */

export function Chip({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        "h-8 shrink-0 rounded-full border px-3 text-[13px] transition-colors active:scale-[.97]",
        active
          ? "border-orange bg-orange text-white"
          : "border-line text-[var(--muted)]",
        className,
      )}
      {...props}
    />
  );
}
