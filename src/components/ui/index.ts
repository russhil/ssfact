/**
 * Sportsun design system.
 *
 * Rules of the house:
 *  - Depth is `.elev` (two soft blurs + a hairline ring), never a hard border.
 *  - Type comes from the scale (.t-display / .t-title / .t-head / .t-body /
 *    .t-sm / .t-xs / .t-micro) — no `text-[13px]`.
 *  - Colour comes from tokens (surface, surface-2, border, hairline, t1/t2/t3,
 *    accent, ok/warn/danger) — no raw slate/indigo, or dark mode breaks.
 *  - Every figure is `tnum`.
 */

export { Card, Panel, PageHeader, SectionTitle, StatCard, DefList, EmptyState, Skeleton, Toolbar } from "./surfaces";
export { Button, ButtonLink, IconButton, buttonClass } from "./button";
export { Input, Textarea, Select, Field, SearchInput, inputClass } from "./form";
export { DataTable, TableWrap, Th, Td, type Column } from "./table";
export { MobileCardList, MobileCard } from "./mobile-list";
export { SegmentedFilter, type SegmentOption } from "./segmented";
export {
  useTableView,
  TableToolbar,
  SortHeader,
  type FilterDef,
  type SortDef,
  type TableView,
  type TableViewOptions,
  type CsvExport,
} from "./table-toolbar";
export { Badge, Tag, StatusDot, Bar } from "./status";
export { Sheet, BottomSheet } from "./sheet";
export { ConfirmProvider, useConfirm, usePrompt } from "./confirm-sheet";
export { NumpadSheet } from "./numpad-sheet";
