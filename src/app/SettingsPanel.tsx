import { useSettings } from './App';
import { Overlay } from './Overlays';
import type { TextSizeSetting, ThemeSetting, TypewriterSpeedSetting } from './uiState';

// The settings overlay content (T2, ui-plan §6 "Settings (FR-3.7)"). Every
// control applies LIVE: an onChange calls `updateSettings` with a partial
// patch, `SettingsProvider` (App.tsx) merges it into the one `Settings`
// object, persists it to `cave.settings` (uiState.ts), and re-runs its
// `data-theme`/`--text-scale` side effects on the same render — there is no
// separate "Apply" button because there is nothing left for one to do.
//
// Chrome is entirely borrowed from T1's `<Overlay>` (Overlays.tsx): the
// native <dialog> it renders already supplies the focus trap, Esc-to-close,
// and one-overlay-at-a-time bookkeeping (standing rule #3) that every panel
// gets for free by wrapping their content in it. This file is only the form.
//
// Hardcore is intentionally NOT here — ui-plan §6 scopes it to "new games
// only," which lives in the per-adventure sidecar (uiState.ts's
// `AdventureUiState.hardcore`) and gets its control from T6/T9's new-game
// flow, not this global panel.

const THEME_OPTIONS: Array<{ value: ThemeSetting; label: string }> = [
  { value: 'dark', label: 'Lamplight (dark)' },
  { value: 'light', label: 'Parchment (light)' },
  { value: 'system', label: 'Match system' },
];

const TEXT_SIZE_OPTIONS: Array<{ value: TextSizeSetting; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const TYPEWRITER_OPTIONS: Array<{ value: TypewriterSpeedSetting; label: string }> = [
  { value: 'instant', label: 'Instant' },
  { value: 'normal', label: 'Normal' },
  { value: 'slow', label: 'Slow' },
];

export function SettingsPanel() {
  const { settings, updateSettings } = useSettings();

  return (
    <Overlay id="settings" title="Settings">
      {/* No submit button and no `action` — every field commits itself via
          onChange, so the only job `preventDefault` has here is stopping a
          stray Enter keypress in a future text field from reloading the
          page (there is no such field yet, but the form wrapper is free). */}
      <form
        className="settings-panel"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="settings-panel__row">
          <label htmlFor="settings-theme">Theme</label>
          <select
            id="settings-theme"
            value={settings.theme}
            onChange={(event) => {
              updateSettings({ theme: event.target.value as ThemeSetting });
            }}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-panel__row">
          <label htmlFor="settings-text-size">Text size</label>
          <select
            id="settings-text-size"
            value={settings.textSize}
            onChange={(event) => {
              updateSettings({ textSize: event.target.value as TextSizeSetting });
            }}
          >
            {TEXT_SIZE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-panel__row">
          <label htmlFor="settings-typewriter-speed">Narration speed</label>
          <select
            id="settings-typewriter-speed"
            value={settings.typewriterSpeed}
            onChange={(event) => {
              updateSettings({ typewriterSpeed: event.target.value as TypewriterSpeedSetting });
            }}
          >
            {TYPEWRITER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-panel__row settings-panel__row--checkbox">
          <label htmlFor="settings-transcript-only">
            <input
              id="settings-transcript-only"
              type="checkbox"
              checked={settings.transcriptOnly}
              onChange={(event) => {
                updateSettings({ transcriptOnly: event.target.checked });
              }}
            />
            Transcript-only — hide the scene panel and its art
          </label>
        </div>

        <div className="settings-panel__row settings-panel__row--checkbox">
          <label htmlFor="settings-reduce-motion">
            <input
              id="settings-reduce-motion"
              type="checkbox"
              checked={settings.reduceMotion}
              onChange={(event) => {
                updateSettings({ reduceMotion: event.target.checked });
              }}
            />
            Reduce motion — disable the lamplight flicker and other animation
          </label>
        </div>
      </form>
    </Overlay>
  );
}
