export const OPEN_LOCATION = "files-plus.open-location";
export const OPEN_OPTIONS = [
  { value: "tab", label: "Tab in center panel" },
  { value: "pane", label: "Pane in center panel" },
  { value: "internal", label: "Inside right panel" },
];

export function openLocation(value) {
  return OPEN_OPTIONS.some(option => option.value === value) ? value : "tab";
}
