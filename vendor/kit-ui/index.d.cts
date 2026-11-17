import * as react from 'react';
import { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "danger";
    /** Marks the button busy; stays focusable and ignores clicks. */
    busy?: boolean;
}
declare const Button: react.ForwardRefExoticComponent<ButtonProps & react.RefAttributes<HTMLButtonElement>>;

interface FieldProps {
    label: string;
    hint?: string;
    error?: string;
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldProps {
}
declare const Input: react.ForwardRefExoticComponent<InputProps & react.RefAttributes<HTMLInputElement>>;

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldProps {
}
/** Wraps a native <select>: keyboard, mobile pickers and screen readers come from the platform (ADR 0006). */
declare const Select: react.ForwardRefExoticComponent<SelectProps & react.RefAttributes<HTMLSelectElement>>;

interface DialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    /** Buttons rendered in the footer. */
    actions?: ReactNode;
}
/**
 * Modal dialog on the native <dialog> element. The browser provides the focus trap,
 * inert background, Esc to close and focus restoration to the opener.
 */
declare function Dialog({ open, onClose, title, children, actions }: DialogProps): react.JSX.Element;

interface ToastOptions {
    message: string;
    variant?: "info" | "error";
    /** Milliseconds before auto-dismiss. 0 keeps it until dismissed. Errors default to 0 (WCAG 2.2.1 timing). */
    duration?: number;
}
declare function useToast(): {
    toast: (o: ToastOptions) => number;
    dismiss: (id: number) => void;
};
declare function ToastProvider({ children }: {
    children: ReactNode;
}): react.JSX.Element;

type Theme = "light" | "dark" | "system";
declare function useTheme(): {
    theme: Theme;
    resolved: "light" | "dark";
    setTheme: (t: Theme) => void;
};
declare function ThemeProvider({ children, defaultTheme }: {
    children: ReactNode;
    defaultTheme?: Theme;
}): react.JSX.Element;

var shared = {
	"space-1": "0.25rem",
	"space-2": "0.5rem",
	"space-3": "0.75rem",
	"space-4": "1rem",
	"space-6": "1.5rem",
	"radius-sm": "0.25rem",
	"radius-md": "0.5rem",
	"font-sans": "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	"font-size-sm": "0.875rem",
	"font-size-md": "1rem",
	"focus-ring-width": "3px",
	"motion-duration": "150ms"
};
var light = {
	"color-bg": "#ffffff",
	"color-surface": "#f6f7f9",
	"color-text": "#14171f",
	"color-text-muted": "#4a5160",
	"color-border": "#8a91a0",
	"color-primary": "#1d4ed8",
	"color-primary-text": "#ffffff",
	"color-danger": "#b42318",
	"color-focus": "#1d4ed8",
	"color-overlay": "rgba(10, 12, 18, 0.55)"
};
var dark = {
	"color-bg": "#0f1219",
	"color-surface": "#1a1f2b",
	"color-text": "#eef0f5",
	"color-text-muted": "#a7aebd",
	"color-border": "#7a8296",
	"color-primary": "#7aa2ff",
	"color-primary-text": "#0b1020",
	"color-danger": "#ff8a80",
	"color-focus": "#9db9ff",
	"color-overlay": "rgba(0, 0, 0, 0.7)"
};
var tokens = {
	shared: shared,
	light: light,
	dark: dark
};

export { Button, type ButtonProps, Dialog, type DialogProps, Input, type InputProps, Select, type SelectProps, type Theme, ThemeProvider, type ToastOptions, ToastProvider, tokens, useTheme, useToast };
