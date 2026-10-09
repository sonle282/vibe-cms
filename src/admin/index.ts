/**
 * @sonle282/vibe-cms/admin — the editor that runs in the browser on /admin (P7). The injected admin route starts it;
 * a site never imports it directly. Exported pieces are also what the tests drive on a fake DOM.
 */
export { editorFields, startAdmin, type AdminOptions } from "./app.js";
export { describeChange, formatHours, imagesIn, plainText, summarizeChanges, type RichImage, type Change, type ChangeKind, type ReferenceLabels, type SummaryInput } from "./changes.js";
export { createForm, LOCK_HELP, OWNER_NOTE, type Form, type FormOptions, type Problem, type ReferenceOption, type ReferenceTarget } from "./form.js";
export { accountScreen, peopleScreen, ROLE_HELP, type PublicUser, type ScreenKit } from "./people.js";
export { createClient, humanMessage, type ApiResult, type Client, type Fetch } from "./api.js";
export { adminBoot, bootJson, type AdminBoot, type BootCollection, type BootFile, type BootMedia, type BootUser } from "./boot.js";
export { ACCEPTED_TYPES, openImagePicker, prepareImage, type LibraryImage, type PickerOptions, type Prepare, type PreparedImage } from "./media.js";
// P8d. The Markdown converter (./markdown.js) is not exported here on purpose: the editor loads it only when needed.
export { createRichEditor, type PickedImage, type RichEditor, type RichEditorOptions } from "./rich-editor.js";
export { cleanRichDom, isEmptyRich, normalizeBlocks } from "./clean.js";
export { clone, countChanges, emptyValue, getAt, holdsLockedValue, ID_PATTERN, keyPath, parsePathText, pathText, same, setAt, slugify, type Path } from "./value.js";
