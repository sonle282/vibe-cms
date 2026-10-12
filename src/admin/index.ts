/**
 * @sonle282/vibe-cms/admin — the editor that runs in the browser on /admin (P7). The injected admin route starts it;
 * a site never imports it directly. Exported pieces are also what the tests drive on a fake DOM.
 */
export { editorFields, startAdmin, type AdminOptions } from "./app.js";
export { describeChange, formatHours, imagesIn, plainText, summarizeChanges, type RichImage, type Change, type ChangeKind, type ReferenceLabels, type SummaryInput } from "./changes.js";
export { createForm, LOCK_HELP, OWNER_NOTE, type Form, type FormOptions, type Problem, type ReferenceOption, type ReferenceTarget } from "./form.js";
export { openChangePassword, peopleScreen, ROLE_HELP, type PublicUser, type ScreenKit } from "./people.js";
export { createClient, humanMessage, type ApiResult, type Client, type Fetch } from "./api.js";
export { adminBoot, bootJson, type AdminBoot, type BootCollection, type BootFile, type BootMedia, type BootUser } from "./boot.js";
export { ACCEPTED_TYPES, adjustImage, CROP_PRESETS, cropRect, measureImage, openImagePicker, outputSize, prepareImage, RESIZE_WIDTHS, type Adjust, type CropRect, type LibraryImage, type Measure, type PickerOptions, type Prepare, type PreparedImage } from "./media.js";
// P8d. The Markdown converter (./markdown.js) is not exported here on purpose: the editor loads it only when needed.
export { createRichEditor, type PickedImage, type RichEditor, type RichEditorOptions } from "./rich-editor.js";
export { cleanRichDom, isEmptyRich, normalizeBlocks } from "./clean.js";
export { attachBridge, bindingPath, configBinds, fieldAt, resolveBinding, resolveList, type Bridge, type BridgeOptions, type PreviewOwner, type PreviewSelection } from "./bridge.js";
export { createPreview, framedUrl, PREVIEW_DEVICES, previewScale, previewUrl, type Preview, type PreviewDevice, type PreviewOptions } from "./preview.js";
// U3: the dialog and the toast of the Mr Spa CMS.
export { confirmDialog, openDialog, type ConfirmOptions, type DialogButton, type DialogOptions, type OpenDialog } from "./dialog.js";
export { createToast, type Tone, type ToastAction } from "./toast.js";
// M1: the addresses, the save state and the tooltip of the Mr Spa CMS.
export { ADMIN_BASE, adminHref, legacyHashPath, parseAdminPath, type AdminRoute } from "./routes.js";
export { applyLeafChanges, deriveSaveState, publishBlockReason, unsavedLeafChanges, type LeafChange, type PublishedState, type SaveState, type SaveStateInput } from "./save-state.js";
export { createTooltipScheduler, installTooltips, tooltipText, TOOLTIP_DELAY_MS } from "./tooltip.js";
export { clone, countChanges, emptyValue, getAt, holdsLockedValue, ID_PATTERN, keyPath, parsePathText, pathText, same, setAt, slugify, type Path } from "./value.js";
