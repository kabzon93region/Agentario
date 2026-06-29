import { en } from "./locales/en"
import { ru, type RuLocale } from "./locales/ru"

export type LocaleId = "ru" | "en"

const locales: Record<LocaleId, RuLocale> = { ru, en: en as RuLocale }

/** Agentario default UI language */
let currentLocale: LocaleId = "ru"

export function getLocale(): LocaleId {
	return currentLocale
}

export function setLocale(locale: LocaleId): void {
	currentLocale = locale
}

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
	const value = path.split(".").reduce<unknown>((acc, key) => {
		if (acc && typeof acc === "object" && key in acc) {
			return (acc as Record<string, unknown>)[key]
		}
		return undefined
	}, obj)
	return typeof value === "string" ? value : undefined
}

export function t(path: string, params?: Record<string, string>): string {
	const raw = getNestedValue(locales[currentLocale] as unknown as Record<string, unknown>, path) ?? path
	if (!params) {
		return raw
	}
	return Object.entries(params).reduce((text, [key, value]) => text.replace(`{${key}}`, value), raw)
}
