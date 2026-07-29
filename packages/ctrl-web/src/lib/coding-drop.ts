// Coding-scoped native file drop — CodingScene's drag-drop attachment
// affordance (ADR-002 substrate §1.8.6 v75; ADR-003 frontend §8.5 v35).
//
// The underlying Tauri drag-drop plumbing moved to `native-file-drop.ts`
// once Irisy's own composer needed the same mechanism (ADR-005 irisy §8.7
// v32) — this module is now a thin, Coding-named re-export so existing call
// sites (`CodingScene.tsx`) don't need to change, while the semantics stay
// distinct: Coding's drop = authoring reference material for opencode,
// Irisy's drop (see `native-file-drop.ts`'s own doc comment) is a separate,
// still-being-defined use. Sharing the mechanism does not merge the intent.

export {
  useNativeFileDrop as useCodingFileDrop,
  type NativeFileDropHandlers as CodingFileDropHandlers,
} from './native-file-drop';
