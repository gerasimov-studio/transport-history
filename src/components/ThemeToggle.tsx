import { useI18n } from '../i18n'
import { useTheme } from '../theme'

export function ThemeToggle() {
  const { t } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={nextTheme === 'light' ? t('theme.useLight') : t('theme.useDark')}
      title={nextTheme === 'light' ? t('theme.useLight') : t('theme.useDark')}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.5" /><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M16 4l-1.4 1.4M5.4 14.6L4 16" /></svg>
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.8A6.5 6.5 0 0 1 7.2 4.2a6.5 6.5 0 1 0 8.6 8.6Z" /></svg>
      )}
    </button>
  )
}
