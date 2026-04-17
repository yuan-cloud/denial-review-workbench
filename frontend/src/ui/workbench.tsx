import { useEffect, useState } from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  PropsWithChildren,
  ReactNode,
} from "react";

export const palette = {
  page: "#f3f5f8",
  surface: "#ffffff",
  surfaceMuted: "#f8fafc",
  border: "#d6dde6",
  borderStrong: "#c3ccd7",
  text: "#101828",
  textMuted: "#667085",
  textSubtle: "#8d98a7",
  primary: "#175cd3",
  primaryHover: "#1849a9",
  primarySoft: "#eaf2ff",
  link: "#2563eb",
  highlight: "#fef08a",
  success: "#027a48",
  successSoft: "#ecfdf3",
  warning: "#b54708",
  warningSoft: "#fffaeb",
  danger: "#b42318",
  dangerSoft: "#fef3f2",
  neutralSoft: "#eef2f6",
};

// Breakpoints
const BREAKPOINT_TABLET = "(max-width: 1099px)";
const BREAKPOINT_MOBILE = "(max-width: 639px)";

export { BREAKPOINT_MOBILE };

export function useMediaQuery(query: string): boolean {
  const supported =
    typeof window !== "undefined" && typeof window.matchMedia === "function";

  const [matches, setMatches] = useState(() =>
    supported ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    if (!supported) return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query, supported]);

  return matches;
}

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";
type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

function toneStyles(tone: Tone): CSSProperties {
  switch (tone) {
    case "primary":
      return {
        background: palette.primarySoft,
        border: `1px solid ${palette.border}`,
        color: palette.primary,
      };
    case "success":
      return {
        background: palette.successSoft,
        border: `1px solid ${palette.border}`,
        color: palette.success,
      };
    case "warning":
      return {
        background: palette.warningSoft,
        border: `1px solid ${palette.border}`,
        color: palette.warning,
      };
    case "danger":
      return {
        background: palette.dangerSoft,
        border: `1px solid ${palette.border}`,
        color: palette.danger,
      };
    default:
      return {
        background: palette.neutralSoft,
        border: `1px solid ${palette.border}`,
        color: palette.textMuted,
      };
  }
}

function buttonStyles(
  variant: ButtonVariant,
  size: ButtonSize,
  disabled: boolean
): CSSProperties {
  const sizeStyle =
    size === "sm"
      ? {
          minHeight: 32,
          padding: "0 12px",
          fontSize: 12,
        }
      : {
          minHeight: 38,
          padding: "0 14px",
          fontSize: 13,
        };

  if (variant === "primary") {
    return {
      ...sizeStyle,
      borderRadius: 8,
      border: `1px solid ${disabled ? palette.borderStrong : palette.primary}`,
      background: disabled ? palette.borderStrong : palette.primary,
      color: "#ffffff",
      fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
      boxShadow: disabled ? "none" : "0 1px 2px rgba(16, 24, 40, 0.08)",
    };
  }

  if (variant === "ghost") {
    return {
      ...sizeStyle,
      borderRadius: 8,
      border: "1px solid transparent",
      background: "transparent",
      color: disabled ? palette.textSubtle : palette.textMuted,
      fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
    };
  }

  return {
    ...sizeStyle,
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    color: disabled ? palette.textSubtle : palette.text,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
  };
}

export const workbenchStyles = {
  page: {
    minHeight: "100vh",
    background: palette.page,
    color: palette.text,
    fontFamily:
      'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  } satisfies CSSProperties,
  pageInner: {
    width: "100%",
    maxWidth: 1320,
    margin: "0 auto",
    padding: 20,
    boxSizing: "border-box",
  } satisfies CSSProperties,
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: 12,
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
  } satisfies CSSProperties,
  panel: {
    minHeight: 0,
    overflow: "auto",
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: 12,
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
  } satisfies CSSProperties,
  sectionHeading: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    margin: "0 0 16px",
    paddingBottom: 12,
    background: palette.surface,
    borderBottom: `1px solid ${palette.border}`,
  } satisfies CSSProperties,
  eyebrow: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: palette.textSubtle,
  } satisfies CSSProperties,
  title: {
    margin: "6px 0 0",
    fontSize: 15,
    fontWeight: 700,
    color: palette.text,
  } satisfies CSSProperties,
  description: {
    margin: "4px 0 0",
    fontSize: 13,
    lineHeight: 1.45,
    color: palette.textMuted,
  } satisfies CSSProperties,
  headingRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  } satisfies CSSProperties,
  label: {
    display: "block",
    marginBottom: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: palette.textSubtle,
  } satisfies CSSProperties,
  field: {
    padding: "10px 12px",
    border: `1px solid ${palette.border}`,
    borderRadius: 10,
    background: palette.surfaceMuted,
  } satisfies CSSProperties,
  fieldValue: {
    fontSize: 14,
    lineHeight: 1.45,
    color: palette.text,
  } satisfies CSSProperties,
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 10,
  } satisfies CSSProperties,
  denseTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  } satisfies CSSProperties,
  denseTableHead: {
    borderBottom: `1px solid ${palette.borderStrong}`,
  } satisfies CSSProperties,
  denseTableHeaderCell: {
    padding: "8px 10px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: palette.textSubtle,
  } satisfies CSSProperties,
  denseTableCell: {
    padding: "10px",
    borderBottom: `1px solid ${palette.border}`,
    color: palette.text,
    verticalAlign: "top",
  } satisfies CSSProperties,
  mono: {
    fontFamily:
      '"SFMono-Regular", SFMono-Regular, ui-monospace, Menlo, Consolas, monospace',
    fontSize: 12,
  } satisfies CSSProperties,
  subdued: {
    color: palette.textMuted,
  } satisfies CSSProperties,
  subtle: {
    color: palette.textSubtle,
  } satisfies CSSProperties,
  dividerTop: {
    marginTop: 18,
    paddingTop: 16,
    borderTop: `1px solid ${palette.border}`,
  } satisfies CSSProperties,
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 10,
  } satisfies CSSProperties,
  summaryItem: {
    minHeight: 92,
    padding: "12px 14px",
    border: `1px solid ${palette.border}`,
    borderRadius: 10,
    background: palette.surfaceMuted,
    boxSizing: "border-box",
  } satisfies CSSProperties,
  summaryItemHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  } satisfies CSSProperties,
  summaryItemLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: palette.textSubtle,
  } satisfies CSSProperties,
  summaryItemValue: {
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: "-0.02em",
    color: palette.text,
  } satisfies CSSProperties,
  summaryItemMeta: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 1.45,
    color: palette.textMuted,
  } satisfies CSSProperties,
  summaryBadgeRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  paneGrid: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns:
      "minmax(360px, 1.35fr) minmax(320px, 1.05fr) minmax(280px, 0.9fr)",
    gap: 16,
    alignItems: "stretch",
    overflowX: "auto",
    paddingBottom: 4,
  } satisfies CSSProperties,
  stack: {
    display: "grid",
    gap: 12,
  } satisfies CSSProperties,
};

export function formatDocumentLabel(docId: string): string {
  return docId
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function WorkbenchScreen({
  children,
  fullHeight = false,
  maxWidth = 1320,
}: PropsWithChildren<{ fullHeight?: boolean; maxWidth?: number }>) {
  const isMobile = useMediaQuery(BREAKPOINT_MOBILE);
  return (
    <div
      style={{
        ...workbenchStyles.page,
        minHeight: fullHeight ? "100vh" : undefined,
      }}
    >
      <div
        style={{
          ...workbenchStyles.pageInner,
          maxWidth,
          padding: isMobile ? 12 : 20,
          minHeight: fullHeight ? "100vh" : undefined,
          display: fullHeight ? "flex" : "block",
          flexDirection: fullHeight ? "column" : undefined,
          gap: fullHeight ? 16 : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function WorkbenchPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const isMobile = useMediaQuery(BREAKPOINT_MOBILE);
  return (
    <div
      style={{
        ...workbenchStyles.topBar,
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? <div style={workbenchStyles.eyebrow}>{eyebrow}</div> : null}
        <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {title}
        </div>
        {description ? (
          <div style={{ ...workbenchStyles.description, marginTop: 6 }}>
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div>{actions}</div> : null}
    </div>
  );
}

export function WorkbenchPanel({
  children,
  padding = 16,
  style,
}: PropsWithChildren<{ padding?: number; style?: CSSProperties }>) {
  return (
    <div style={{ ...workbenchStyles.panel, ...style }}>
      <div style={{ padding, minHeight: "100%", boxSizing: "border-box" }}>
        {children}
      </div>
    </div>
  );
}

export function WorkbenchSummaryStrip({
  children,
  style,
  ariaLabel = "Run summary",
}: PropsWithChildren<{ style?: CSSProperties; ariaLabel?: string }>) {
  return (
    <section
      aria-label={ariaLabel}
      style={{
        ...workbenchStyles.panel,
        overflow: "visible",
        padding: 14,
        ...style,
      }}
    >
      <div style={workbenchStyles.summaryGrid}>{children}</div>
    </section>
  );
}

export function WorkbenchSummaryItem({
  label,
  value,
  meta,
  badges,
  tone = "neutral",
  valueStyle,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  tone?: Tone;
  valueStyle?: CSSProperties;
}) {
  return (
    <div style={{ ...workbenchStyles.summaryItem, ...toneStyles(tone) }}>
      <div style={workbenchStyles.summaryItemHeader}>
        <span style={workbenchStyles.summaryItemLabel}>{label}</span>
        {badges ? <div style={workbenchStyles.summaryBadgeRow}>{badges}</div> : null}
      </div>
      <div style={{ ...workbenchStyles.summaryItemValue, ...valueStyle }}>{value}</div>
      {meta ? <div style={workbenchStyles.summaryItemMeta}>{meta}</div> : null}
    </div>
  );
}

export function WorkbenchSectionHeading({
  eyebrow,
  title,
  description,
  badge,
  sticky = false,
  actions,
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  badge?: ReactNode;
  sticky?: boolean;
  actions?: ReactNode;
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}) {
  return (
    <div
      style={
        sticky
          ? workbenchStyles.sectionHeading
          : { margin: "0 0 16px", paddingBottom: 12, borderBottom: `1px solid ${palette.border}` }
      }
    >
      <div style={workbenchStyles.headingRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? <div style={workbenchStyles.eyebrow}>{eyebrow}</div> : null}
          <Tag style={workbenchStyles.title}>{title}</Tag>
          {description ? (
            <div style={workbenchStyles.description}>{description}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {badge}
          {actions}
        </div>
      </div>
    </div>
  );
}

export function WorkbenchPaneGrid({
  children,
  style,
  columns,
  testId,
}: PropsWithChildren<{
  style?: CSSProperties;
  columns?: CSSProperties["gridTemplateColumns"];
  testId?: string;
}>) {
  const isStacked = useMediaQuery(BREAKPOINT_TABLET);
  return (
    <div
      data-testid={testId}
      style={{
        ...workbenchStyles.paneGrid,
        gridTemplateColumns: isStacked
          ? "1fr"
          : (columns ?? workbenchStyles.paneGrid.gridTemplateColumns),
        overflowX: isStacked ? "visible" : "auto",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function WorkbenchField({
  label,
  children,
  tone = "neutral",
  style,
}: PropsWithChildren<{
  label: string;
  tone?: Tone;
  style?: CSSProperties;
}>) {
  return (
    <div style={{ ...workbenchStyles.field, ...toneStyles(tone), ...style }}>
      <span style={workbenchStyles.label}>{label}</span>
      <div style={workbenchStyles.fieldValue}>{children}</div>
    </div>
  );
}

export function WorkbenchNotice({
  title,
  children,
  tone = "neutral",
}: PropsWithChildren<{ title?: string; tone?: Tone }>) {
  return (
    <div
      style={{
        ...toneStyles(tone),
        padding: "12px 14px",
        borderRadius: 10,
      }}
    >
      {title ? (
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      ) : null}
      <div style={{ fontSize: 13, lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}

export function WorkbenchStatusPill({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: Tone }>) {
  return (
    <span
      style={{
        ...toneStyles(tone),
        display: "inline-flex",
        alignItems: "center",
        minHeight: 24,
        padding: "0 10px",
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

export function WorkbenchActionBar({
  children,
  justify = "flex-start",
}: PropsWithChildren<{
  justify?: CSSProperties["justifyContent"];
}>) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: justify,
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

export function WorkbenchButton({
  variant = "secondary",
  size = "md",
  style,
  children,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...buttonProps}
      style={{
        ...buttonStyles(variant, size, Boolean(buttonProps.disabled)),
        ...style,
      }}
    >
      {children}
    </button>
  );
}
