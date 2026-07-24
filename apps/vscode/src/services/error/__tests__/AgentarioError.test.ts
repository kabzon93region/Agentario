import { describe, it } from "bun:test"
import "should"
import { AgentarioError, AgentarioErrorType } from "../AgentarioError"

describe("AgentarioError", () => {
	describe("getErrorType", () => {
		it("should return QuotaExceeded when code is INFERENCE_CAP_ERROR", () => {
			const err = new AgentarioError({ message: "Inference cap reached", code: "INFERENCE_CAP_ERROR" })
			AgentarioError.getErrorType(err)!.should.equal(AgentarioErrorType.QuotaExceeded)
		})

		it("should return Entitlement for the SDK ClinePass subscription message", () => {
			const err = new AgentarioError(
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://app.cline.bot/promo?code=CLI-8OFF&personal=true",
			)

			AgentarioError.getErrorType(err)!.should.equal(AgentarioErrorType.Entitlement)
		})

		it("should return Entitlement for the SDK ClinePass subscription message with a different app URL", () => {
			const err = new AgentarioError(
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://staging-app.cline.bot/promo?code=CLI-8OFF&personal=true",
			)

			AgentarioError.getErrorType(err)!.should.equal(AgentarioErrorType.Entitlement)
		})

		it("should return Entitlement for the raw required-plan message", () => {
			const err = new AgentarioError("403 Error 403: the user is not subscribed to required model plan")

			AgentarioError.getErrorType(err)!.should.equal(AgentarioErrorType.Entitlement)
		})

		it("should classify the SDK org individual subscription message separately", () => {
			const err = new AgentarioError(
				"Organization accounts cannot use ClinePass subscriptions. Go to /account -> change account to switch to your personal account for ClinePass",
			)

			AgentarioError.getErrorType(err)!.should.equal(AgentarioErrorType.OrgAgentarioPassRestriction)
		})

		it("should classify the raw organization individual subscription message separately", () => {
			const err = new AgentarioError("403 Error 403: organization accounts cannot use individual model inference subscriptions")

			AgentarioError.getErrorType(err)!.should.equal(AgentarioErrorType.OrgAgentarioPassRestriction)
		})
	})
})
