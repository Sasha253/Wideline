// The Wideline UI library (Floodlight). Three sections, one owner each; see the
// file-ownership map in docs/design-handoff/IMPLEMENTATION.md. Edit only your section.

// --- core ---
export {
  Button,
  ButtonLink,
  buttonClass,
  IconButton,
  Kbd,
  LOADING_LABEL,
  type ButtonSize,
  type ButtonVariant,
  type LegacyButtonSize,
} from "./Button";
export { ConfidenceMeter, LOW_CONFIDENCE } from "./ConfidenceMeter";
export { ConsentBadge, consentBadgeState, type ConsentBadgeState } from "./ConsentBadge";
export { ICON_SIZE, ICON_SIZE_DENSE, iconProps } from "./icons";
export { ConfirmModal, Modal, Sheet } from "./Modal";
export { SegmentedFilter, type SegmentOption } from "./SegmentedFilter";
export {
  ClaimStatusChip,
  ClubStatusChip,
  EventStatusChip,
  FlagStateChip,
  FootageChip,
  InvitationStatusChip,
  JobStatusChip,
  MatchStatusChip,
  OrganisationStatusChip,
  ScoutStatusChip,
  StatusChip,
  type ChipSize,
  type ChipTone,
  type EventReviewState,
  type FootageState,
  type InvitationState,
  type JobChipState,
  type MatchChipStatus,
  type StatusChipProps,
} from "./StatusChip";
export { TabPanel, tabId, tabPanelId, Tabs, type TabItem } from "./Tabs";
export { TeamMarker, type Side, type TeamMarkerSize } from "./TeamMarker";
export {
  FieldMessage,
  SearchSelect,
  Select,
  TextArea,
  TextField,
  type SearchSelectOption,
  type SelectOption,
} from "./TextField";
export {
  Toast,
  TOAST_DURATION,
  ToastProvider,
  useToast,
  type ToastAction,
  type ToastApi,
  type ToastInput,
  type ToastOptions,
  type ToastTone,
} from "./Toast";
// theme.tsx is foundation-owned; listed here so the barrel stays in three sections.
// The server-only ReviewThemeScope is in ./theme-server and is not exported here.
export {
  DEFAULT_THEME,
  isThemeChoice,
  setThemeChoice,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  ThemeScope,
  ThemeScript,
  useTheme,
  type ResolvedTheme,
  type ThemeChoice,
} from "./theme";

// --- domain ---
export { Cover } from "./Cover";
export {
  EXPIRY_CONSEQUENCE,
  expiryLead,
  expiryLevel,
  expiryStep,
  formatCountdown,
  formatCountdownWords,
  formatDeletionDate,
  formatExpiryDate,
  formatRoughTimeLeft,
  formatTimeLeft,
  type ExpiryLevel,
  type ExpiryStep,
} from "./expiry";
export {
  ClaimTimeLeft,
  ClipsTimeLeft,
  ExpiryBanner,
  ExpiryLabel,
  FootageTimeLeft,
  InlineStatus,
} from "./ExpiryBanner";
export { ExpiryChip, useMinuteClock } from "./ExpiryChip";
export { MiniPitch, type PitchSpot } from "./MiniPitch";
export {
  AveragePositionMap,
  HEAT_RAMP,
  heatLevel,
  heatStep,
  PitchBox,
  PitchHeatmap,
  PitchLines,
  type HeatHalf,
  type PlayerPosition,
} from "./PitchHeatmap";
export { initials, PlayerCard, type PlayerFigure, type PlayerStat } from "./PlayerCard";
export { PlayerCardMenu } from "./PlayerCardMenu";
export {
  eventDisc,
  ReviewEventListHeader,
  ReviewEventRow,
  SAVED_MS,
  whoLabel,
  type EventDisc,
  type EventWho,
} from "./ReviewEventRow";
export { matchCount, StatStrip, StatTile } from "./StatTile";
export { StateMessage, type StateKind } from "./StateMessage";
export { StepHeader, type StepItem, type StepState } from "./StepHeader";
// DataTable, DataListRow and DataTablePagination live in @/components/templates/DataTable.

// --- shell ---
// The shell components themselves are in @/components/shell/* (AppShell, NavLinks,
// OrgSwitcher, AccountMenu, ImpersonationBanner, shortcuts).
export { Logo, LogoMark, type LogoSize } from "./Logo";
