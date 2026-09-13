import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './lib/api'

export type Locale = 'en' | 'sr' | 'ru'

export const LOCALES: Array<{ id: Locale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'sr', label: 'Srpski' },
  { id: 'ru', label: 'Русский' },
]

const messages = {
  en: {
    'app.title': 'History of transport', loading: 'Loading…', map: 'Map', editor: 'Editor',
    'account.title': 'My space', 'account.kicker': 'One workspace', 'account.maps': 'My maps',
    'account.changes': 'My changes', 'account.moderation': 'For my review', 'account.login': 'Sign in through the editor first.',
    'account.main': 'Main map', 'account.scenario': 'Scenario', 'account.open': 'Open in editor',
    'account.view': 'View', 'account.create': 'Create scenario', 'account.scenarioName': 'Alternative history name',
    'account.noTitle': 'Untitled', 'account.networkChanges': 'Network changes', 'account.noDescription': 'No description',
    'account.publish': 'Publish', 'account.published': 'Changes published to the main map',
    'language': 'Language',
    'viewer.alternative': 'Alternative history', 'viewer.changes': 'Changes', 'viewer.noDifferences': 'no differences',
    'viewer.firstDate': 'first date', 'viewer.basemap': 'Basemap', 'viewer.export': 'Download SVG',
    'modes.title': 'Transport modes', 'modes.hidden': 'hidden', 'routes.title': 'Routes',
    'routes.none': 'No routes on this date.', 'routes.all': 'All', 'routes.hide': 'Hide', 'routes.of': 'of',
    'history.title': 'Historical context', 'history.none': 'No data', 'history.noArticles': 'No articles for the selected modes.',
    'timeline': 'Timeline', 'login.studio': 'Studio', 'login.title': 'Edit network',
    'login.lead': 'Draw infrastructure first, then assemble routes.', 'login.username': 'Username',
    'login.password': 'Password', 'login.submit': 'Sign in', 'login.error': 'Incorrect username or password',
    'studio.mySpace': 'My space', 'studio.logout': 'Sign out', 'studio.dates': 'Dates', 'studio.new': 'New',
    'studio.article': 'Article', 'studio.date': 'Date', 'studio.mode': 'Transport mode', 'studio.heading': 'Title',
    'studio.text': 'Text', 'studio.network': 'Network', 'studio.infrastructure': 'Infrastructure', 'studio.routes': 'Routes',
    'studio.saveDraft': 'Save draft', 'studio.saved': 'Draft saved', 'studio.saving': 'Saving…',
    'studio.submit': 'Submit for review', 'studio.select': 'Select', 'studio.track': 'Track',
    'studio.street': 'Street', 'studio.stop': 'Stop', 'studio.node': 'Node', 'studio.name': 'Name',
    'studio.color': 'Color', 'studio.addRoute': 'Add route', 'studio.delete': 'Delete',
    'way.rail': 'Rail transport', 'way.road': 'Road transport',
    'mode.metro': 'Metro', 'mode.tram': 'Tram', 'mode.trolleybus': 'Trolleybus', 'mode.bus': 'Bus',
    'account.error': 'Error', 'account.publishError': 'Could not publish changes',
    'account.register': 'Create account', 'account.haveAccount': 'I already have an account',
    'account.passwordHint': 'At least 8 characters', 'account.users': 'Users', 'account.role': 'Role',
    'account.user': 'User', 'account.moderator': 'Moderator', 'account.superuser': 'Superuser',
    'account.requestChanges': 'Request changes', 'account.reject': 'Reject',
    'account.admin': 'Manage roles', 'account.back': 'Back to my space',
  },
  sr: {
    'app.title': 'Istorija saobraćaja', loading: 'Učitavanje…', map: 'Mapa', editor: 'Uređivač',
    'account.title': 'Moj prostor', 'account.kicker': 'Jedinstveni radni prostor', 'account.maps': 'Moje mape',
    'account.changes': 'Moje izmene', 'account.moderation': 'Za moju proveru', 'account.login': 'Prvo se prijavite kroz uređivač.',
    'account.main': 'Glavna mapa', 'account.scenario': 'Scenario', 'account.open': 'Otvori u uređivaču',
    'account.view': 'Pogledaj', 'account.create': 'Napravi scenario', 'account.scenarioName': 'Naziv alternativne istorije',
    'account.noTitle': 'Bez naslova', 'account.networkChanges': 'Izmene mreže', 'account.noDescription': 'Bez opisa',
    'account.publish': 'Objavi', 'account.published': 'Izmene su objavljene na glavnoj mapi',
    'language': 'Jezik',
    'viewer.alternative': 'Alternativna istorija', 'viewer.changes': 'Izmene', 'viewer.noDifferences': 'bez razlika',
    'viewer.firstDate': 'prvi datum', 'viewer.basemap': 'Kartografska podloga', 'viewer.export': 'Preuzmi SVG',
    'modes.title': 'Vrste prevoza', 'modes.hidden': 'skriveno', 'routes.title': 'Linije',
    'routes.none': 'Nema linija za ovaj datum.', 'routes.all': 'Sve', 'routes.hide': 'Sakrij', 'routes.of': 'od',
    'history.title': 'Istorijski kontekst', 'history.none': 'Nema podataka', 'history.noArticles': 'Nema članaka za izabrane vrste prevoza.',
    'timeline': 'Vremenska linija', 'login.studio': 'Studio', 'login.title': 'Uređivanje mreže',
    'login.lead': 'Prvo nacrtajte infrastrukturu, zatim sastavite linije.', 'login.username': 'Korisničko ime',
    'login.password': 'Lozinka', 'login.submit': 'Prijavi se', 'login.error': 'Pogrešno korisničko ime ili lozinka',
    'studio.mySpace': 'Moj prostor', 'studio.logout': 'Odjavi se', 'studio.dates': 'Datumi', 'studio.new': 'Novo',
    'studio.article': 'Članak', 'studio.date': 'Datum', 'studio.mode': 'Vrsta prevoza', 'studio.heading': 'Naslov',
    'studio.text': 'Tekst', 'studio.network': 'Mreža', 'studio.infrastructure': 'Infrastruktura', 'studio.routes': 'Linije',
    'studio.saveDraft': 'Sačuvaj nacrt', 'studio.saved': 'Nacrt je sačuvan', 'studio.saving': 'Čuvanje…',
    'studio.submit': 'Pošalji na proveru', 'studio.select': 'Izbor', 'studio.track': 'Pruga',
    'studio.street': 'Ulica', 'studio.stop': 'Stajalište', 'studio.node': 'Čvor', 'studio.name': 'Naziv',
    'studio.color': 'Boja', 'studio.addRoute': 'Dodaj liniju', 'studio.delete': 'Obriši',
    'way.rail': 'Železnički saobraćaj', 'way.road': 'Drumski saobraćaj',
    'mode.metro': 'Metro', 'mode.tram': 'Tramvaj', 'mode.trolleybus': 'Trolejbus', 'mode.bus': 'Autobus',
    'account.error': 'Greška', 'account.publishError': 'Izmene nisu objavljene',
    'account.register': 'Napravi nalog', 'account.haveAccount': 'Već imam nalog',
    'account.passwordHint': 'Najmanje 8 znakova', 'account.users': 'Korisnici', 'account.role': 'Uloga',
    'account.user': 'Korisnik', 'account.moderator': 'Moderator', 'account.superuser': 'Superkorisnik',
    'account.requestChanges': 'Traži izmene', 'account.reject': 'Odbij',
    'account.admin': 'Upravljanje ulogama', 'account.back': 'Nazad u moj prostor',
  },
  ru: {
    'app.title': 'История транспорта', loading: 'Загрузка…', map: 'Карта', editor: 'Редактор',
    'account.title': 'Моё пространство', 'account.kicker': 'Единое рабочее пространство', 'account.maps': 'Мои карты',
    'account.changes': 'Мои изменения', 'account.moderation': 'На моей модерации', 'account.login': 'Сначала войдите через редактор.',
    'account.main': 'Основная карта', 'account.scenario': 'Сценарий', 'account.open': 'Открыть в редакторе',
    'account.view': 'Посмотреть', 'account.create': 'Создать сценарий', 'account.scenarioName': 'Название альтернативной истории',
    'account.noTitle': 'Без заголовка', 'account.networkChanges': 'Изменения сети', 'account.noDescription': 'Без описания',
    'account.publish': 'Опубликовать', 'account.published': 'Изменения опубликованы на основной карте',
    'language': 'Язык',
    'viewer.alternative': 'Альтернативная история', 'viewer.changes': 'Изменения', 'viewer.noDifferences': 'без отличий',
    'viewer.firstDate': 'первая дата', 'viewer.basemap': 'Геоподоснова', 'viewer.export': 'Скачать SVG',
    'modes.title': 'Виды транспорта', 'modes.hidden': 'скрыты', 'routes.title': 'Маршруты',
    'routes.none': 'На эту дату маршрутов нет.', 'routes.all': 'Все', 'routes.hide': 'Скрыть', 'routes.of': 'из',
    'history.title': 'Историческая справка', 'history.none': 'Нет данных', 'history.noArticles': 'Нет статей для выбранных видов транспорта.',
    'timeline': 'Временная шкала', 'login.studio': 'Студия', 'login.title': 'Правка сети',
    'login.lead': 'Сначала нарисуйте инфраструктуру, затем соберите маршруты.', 'login.username': 'Логин',
    'login.password': 'Пароль', 'login.submit': 'Войти', 'login.error': 'Неверный логин или пароль',
    'studio.mySpace': 'Моё пространство', 'studio.logout': 'Выйти', 'studio.dates': 'Даты', 'studio.new': 'Новая',
    'studio.article': 'Статья', 'studio.date': 'Дата', 'studio.mode': 'Вид транспорта', 'studio.heading': 'Заголовок',
    'studio.text': 'Текст', 'studio.network': 'Сеть', 'studio.infrastructure': 'Инфраструктура', 'studio.routes': 'Маршруты',
    'studio.saveDraft': 'Сохранить черновик', 'studio.saved': 'Черновик сохранён', 'studio.saving': 'Сохранение…',
    'studio.submit': 'Отправить на модерацию', 'studio.select': 'Выбор', 'studio.track': 'Путь',
    'studio.street': 'Улица', 'studio.stop': 'Остановка', 'studio.node': 'Узел', 'studio.name': 'Имя',
    'studio.color': 'Цвет', 'studio.addRoute': 'Добавить маршрут', 'studio.delete': 'Удалить',
    'way.rail': 'Рельсовый транспорт', 'way.road': 'Дорожный транспорт',
    'mode.metro': 'Метро', 'mode.tram': 'Трамвай', 'mode.trolleybus': 'Троллейбус', 'mode.bus': 'Автобус',
    'account.error': 'Ошибка', 'account.publishError': 'Не удалось опубликовать изменения',
    'account.register': 'Создать аккаунт', 'account.haveAccount': 'У меня уже есть аккаунт',
    'account.passwordHint': 'Минимум 8 символов', 'account.users': 'Пользователи', 'account.role': 'Роль',
    'account.user': 'Пользователь', 'account.moderator': 'Модератор', 'account.superuser': 'Суперпользователь',
    'account.requestChanges': 'Вернуть на доработку', 'account.reject': 'Отклонить',
    'account.admin': 'Управление ролями', 'account.back': 'Назад в моё пространство',
  },
} as const

type MessageKey = keyof typeof messages.en
type I18nValue = { locale: Locale; setLocale: (locale: Locale, persist?: boolean) => Promise<void>; t: (key: MessageKey) => string }
const I18nContext = createContext<I18nValue | null>(null)

function detectedLocale(): Locale {
  const candidate = navigator.languages.map((value) => value.toLowerCase().split('-')[0]).find((value) => value === 'sr' || value === 'ru')
  return candidate === 'sr' || candidate === 'ru' ? candidate : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(detectedLocale)
  useEffect(() => {
    api<{ user: { preferredLanguage: Locale | null } }>('/api/me')
      .then((body) => { if (body.user.preferredLanguage) updateLocale(body.user.preferredLanguage) })
      .catch(() => undefined)
  }, [])
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  const value = useMemo<I18nValue>(() => ({
    locale,
    async setLocale(next, persist = false) {
      updateLocale(next)
      if (persist) await api('/api/me', { method: 'PATCH', body: JSON.stringify({ language: next }) })
    },
    t: (key) => messages[locale][key] ?? messages.en[key],
  }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('I18nProvider is missing')
  return value
}
