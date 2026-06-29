import { t } from "@/i18n"

export enum NEW_USER_TYPE {
	CLINE_PASS = "cline-pass",
	FREE = "free",
	POWER = "power",
	BYOK = "byok",
}

type UserTypeSelection = {
	title: string
	description: string
	type: NEW_USER_TYPE
}

export function getStepConfig() {
	return {
		0: {
			title: t("onboarding.howToUse"),
			description: t("onboarding.selectOption"),
			buttons: [
				{ text: t("onboarding.continue"), action: "next" as const, variant: "default" as const },
				{ text: t("onboarding.login"), action: "signin" as const, variant: "secondary" as const },
			],
		},
		[NEW_USER_TYPE.CLINE_PASS]: {
			title: t("onboarding.selectClinePassModel"),
			buttons: [
				{ text: t("onboarding.createAccount"), action: "signup" as const, variant: "default" as const },
				{ text: t("onboarding.back"), action: "back" as const, variant: "secondary" as const },
			],
		},
		[NEW_USER_TYPE.FREE]: {
			title: t("onboarding.selectFreeModel"),
			buttons: [
				{ text: t("onboarding.createAccount"), action: "signup" as const, variant: "default" as const },
				{ text: t("onboarding.back"), action: "back" as const, variant: "secondary" as const },
			],
		},
		[NEW_USER_TYPE.POWER]: {
			title: t("onboarding.selectModel"),
			buttons: [
				{ text: t("onboarding.createAccount"), action: "signup" as const, variant: "default" as const },
				{ text: t("onboarding.back"), action: "back" as const, variant: "secondary" as const },
			],
		},
		[NEW_USER_TYPE.BYOK]: {
			title: t("onboarding.configureProvider"),
			buttons: [
				{ text: t("onboarding.continue"), action: "done" as const, variant: "default" as const },
				{ text: t("onboarding.back"), action: "back" as const, variant: "secondary" as const },
			],
		},
		2: {
			title: t("onboarding.almostThere"),
			description: t("onboarding.almostThereDesc"),
			buttons: [{ text: t("onboarding.back"), action: "back" as const, variant: "secondary" as const }],
		},
	} as const
}

/** Free leads (and is the default); ClinePass is inserted second when its models are available. */
export function getUserTypeSelections(hasClinePassModels: boolean): UserTypeSelection[] {
	const base: UserTypeSelection[] = [
		{
			title: t("onboarding.absolutelyFree"),
			description: t("onboarding.absolutelyFreeDesc"),
			type: NEW_USER_TYPE.FREE,
		},
		{
			title: t("onboarding.frontierModel"),
			description: t("onboarding.frontierModelDesc"),
			type: NEW_USER_TYPE.POWER,
		},
		{
			title: t("onboarding.byok"),
			description: t("onboarding.byokDesc"),
			type: NEW_USER_TYPE.BYOK,
		},
	]

	if (!hasClinePassModels) {
		return base
	}

	const clinePassSelection: UserTypeSelection = {
		title: t("onboarding.clinePassRecommended"),
		description: t("onboarding.clinePassDesc"),
		type: NEW_USER_TYPE.CLINE_PASS,
	}

	const [free, ...rest] = base
	return [free, clinePassSelection, ...rest]
}
